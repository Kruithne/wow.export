/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';

import { fileExists } from '../../generics';

import Log from '../../log';
import Listfile from '../../casc/listfile';
import BufferWrapper from '../../buffer';
import State from '../../state';

import BLPFile from '../../casc/blp';
import M2Loader from '../loaders/M2Loader';
import OBJWriter from '../writers/OBJWriter';
import MTLWriter from '../writers/MTLWriter';
import JSONWriter from '../writers/JSONWriter';
import ExportHelper from '../../casc/export-helper';

import getGeosetName from '../GeosetMapper';
import GeosetEntry from '../GeosetEntry';

import Texture from '../Texture';
import Skin from '../Skin';

type TextureManifestEntry = {
	fileDataID: number,
	file: string
};

type ExportedTexture = {
	matName: string,
	matPathRelative: string,
	matPath: string;
};

export default class M2Exporter {
	m2: M2Loader;
	fileDataID: number;
	variantTextures?: Array<number>;
	geosetMask: Array<GeosetEntry>;

	/**
	 * Construct a new M2Exporter instance.
	 * @param data
	 * @param variantTextures
	 * @param fileDataID
	 */
	constructor(data: BufferWrapper, variantTextures: Array<number> | undefined, fileDataID: number) {
		this.m2 = new M2Loader(data);
		this.fileDataID = fileDataID;
		this.variantTextures = variantTextures;
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param mask
	 */
	setGeosetMask(mask: Array<GeosetEntry>): void {
		this.geosetMask = mask;
	}

	/**
	 * Export the textures for this M2 model.
	 * @param out - The output directory.
	 * @param raw - Whether to export the raw texture files.
	 * @param mtl - The MTL writer.
	 * @param helper - The export helper.
	 * @param fullTexPaths - Whether to use full texture paths in the MTL file.
	 * @returns A map of texture indices to texture file names.
	 */
	async exportTextures(out: string, raw: boolean = false, mtl: MTLWriter | null, helper: ExportHelper, fullTexPaths: boolean = false): Promise<Map<number, ExportedTexture>> {
		const config = State.config;
		const validTextures = new Map<number, ExportedTexture>();

		if (!config.modelsExportTextures)
			return validTextures;

		this.m2.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';

		let textureIndex = 0;
		for (const texture of this.m2.textures) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return validTextures;

			const textureType = this.m2.textureTypes[textureIndex];
			let texFileDataID = texture.fileDataID;

			if (textureType > 0) {
				let targetFileDataID = 0;

				if (textureType >= 11 && textureType < 14) {
					// Creature textures.
					targetFileDataID = this.variantTextures[textureType - 11];
				} else if (textureType > 1 && textureType < 5) {
					targetFileDataID = this.variantTextures[textureType - 2];
				}

				texFileDataID = targetFileDataID;

				// Backward patch the variant texture into the M2 instance so that
				// the MTL exports with the correct texture once we swap it here.
				texture.fileDataID = targetFileDataID;
			}

			if (texFileDataID > 0) {
				try {
					let texFile = texFileDataID + (raw ? '.blp' : '.png');
					let texPath = path.join(out, texFile);

					// Default MTL name to the file ID (prefixed for Maya).
					let matName = 'mat_' + texFileDataID;
					let fileName = Listfile.getByID(texFileDataID);

					if (fileName !== undefined) {
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');

						// Remove spaces from material name for MTL compatibility.
						if (State.config.removePathSpaces)
							matName = matName.replace(/\s/g, '');
					}

					// Map texture files relative to its own path.
					if (config.enableSharedTextures) {
						if (fileName !== undefined) {
							// Replace BLP extension with PNG.
							if (raw === false)
								fileName = ExportHelper.replaceExtension(fileName, '.png');
						} else {
							// Handle unknown files.
							fileName = Listfile.formatUnknownFile(texFileDataID);
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = path.relative(out, texPath);
					}

					if (config.overwriteFiles || !await fileExists(texPath)) {
						const data = await State.casc.getFile(texFileDataID);
						Log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);

						if (raw === true) {
							// Write raw BLP files.
							await data.writeToFile(texPath);
						} else {
							// Convert BLP to PNG.
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111);
						}
					} else {
						Log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					mtl?.addMaterial(matName, texFile);
					validTextures.set(texFileDataID, {
						matName: fullTexPaths ? texFile : matName,
						matPathRelative: texFile,
						matPath: texPath
					});
				} catch (e) {
					Log.write('Failed to export texture %d for M2: %s', texFileDataID, e.message);
				}
			}

			textureIndex++;
		}

		return validTextures;
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param out
	 * @param exportCollision
	 * @param helper
	 */
	async exportAsOBJ(out: string, exportCollision: boolean = false, helper: ExportHelper): Promise<void> {
		this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = State.config;
		const exportMeta = State.config.exportM2Meta;
		const exportBones = State.config.exportM2Bones;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = path.dirname(out);

		Log.write('Exporting M2 model %s as OBJ: %s', this.m2.name, out);

		// Use internal M2 name for object.
		obj.setName(this.m2.name);

		// Verts, normals, UVs
		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.addUVArray(this.m2.uv);

		if (State.config.modelsExportUV2)
			obj.addUVArray(this.m2.uv2);

		// Textures
		const validTextures = await this.exportTextures(outDir, false, mtl, helper);

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		// Export bone data to a separate JSON file due to the excessive size.
		// A normal meta-data file is around 8kb without bones, 65mb with bones.
		if (exportBones) {
			const json = new JSONWriter(ExportHelper.replaceExtension(out, '_bones.json'));
			json.addProperty('bones', this.m2.bones);
			json.addProperty('boneWeights', this.m2.boneWeights);
			json.addProperty('boneIndicies', this.m2.boneIndices);

			await json.write(config.overwriteFiles);
		}

		if (exportMeta) {
			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));

			// Clone the submesh array and add a custom 'enabled' property
			// to indicate to external readers which submeshes are not included
			// in the actual geometry file.
			const subMeshes = Array(skin.subMeshes.length);
			for (let i = 0, n = subMeshes.length; i < n; i++) {
				const subMeshEnabled = !this.geosetMask || this.geosetMask[i].checked;
				subMeshes[i] = Object.assign({ enabled: subMeshEnabled }, skin.subMeshes[i]);
			}

			// Clone M2 textures array and expand the entries to include internal
			// and external paths/names for external convenience. GH-208
			const textures = new Array(this.m2.textures.length);
			for (let i = 0, n = textures.length; i < n; i++) {
				const texture = this.m2.textures[i];
				const textureEntry = validTextures.get(texture.fileDataID);

				textures[i] = Object.assign({
					fileNameInternal: Listfile.getByID(texture.fileDataID),
					fileNameExternal: textureEntry?.matPathRelative,
					mtlName: textureEntry?.matName
				}, texture);
			}

			json.addProperty('fileDataID', this.fileDataID);
			json.addProperty('fileName', Listfile.getByID(this.fileDataID));
			json.addProperty('internalName', this.m2.name);
			json.addProperty('textures', textures);
			json.addProperty('textureTypes', this.m2.textureTypes);
			json.addProperty('materials', this.m2.materials);
			json.addProperty('textureCombos', this.m2.textureCombos);
			json.addProperty('skeletonFileID', this.m2.skeletonFileID);
			json.addProperty('boneFileIDs', this.m2.boneFileIDs);
			json.addProperty('animFileIDs', this.m2.animFileIDs);
			json.addProperty('colors', this.m2.colors);
			json.addProperty('textureWeights', this.m2.textureWeights);
			json.addProperty('transparencyLookup', this.m2.transparencyLookup);
			json.addProperty('textureTransforms', this.m2.textureTransforms);
			json.addProperty('textureTransformsLookup', this.m2.textureTransformsLookup);
			json.addProperty('boundingBox', this.m2.boundingBox);
			json.addProperty('boundingSphereRadius', this.m2.boundingSphereRadius);
			json.addProperty('collisionBox', this.m2.collisionBox);
			json.addProperty('collisionSphereRadius', this.m2.collisionSphereRadius);
			json.addProperty('skin', {
				subMeshes: subMeshes,
				textureUnits: skin.textureUnits,
				fileName: skin.fileName,
				fileDataID: skin.fileDataID
			});

			await json.write(config.overwriteFiles);
		}

		// Faces
		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			// Skip geosets that are not enabled.
			if (this.geosetMask && !this.geosetMask[mI].checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			let texture: Texture;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit)
				texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

			let matName: string;
			if (texture?.fileDataID > 0 && validTextures.has(texture.fileDataID))
				matName = validTextures.get(texture.fileDataID).matName;

			obj.addMesh(getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);

		if (exportCollision) {
			const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices, undefined);

			await phys.write(config.overwriteFiles);
		}
	}

	/**
	 * Export the model as a raw M2 file, including related files
	 * such as textures, bones, animations, etc.
	 * @param out
	 * @param helper
	 */
	async exportRaw(out: string, helper: ExportHelper): Promise<void> {
		const casc = State.casc;
		const config = State.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.fileDataID);

		// Write the M2 file with no conversion.
		await this.m2.data.writeToFile(out);

		// Only load M2 data if we need to export related files.
		if (config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone || config.modelsExportAnim)
			this.m2.load();

		// Directory that relative files should be exported to.
		const outDir = path.dirname(out);

		// Write relative skin files.
		if (config.modelsExportSkin) {
			const textures = await this.exportTextures(outDir, true, null, helper);
			const texturesManifest = Array<TextureManifestEntry>();
			for (const [texFileDataID, texInfo] of textures)
				texturesManifest.push({ fileDataID: texFileDataID, file: path.relative(outDir, texInfo.matPath) });

			manifest.addProperty('textures', texturesManifest);

			const exportSkins = async (skins: Array<Skin>, typeName: string, manifestName: string): Promise<void> => {
				const skinsManifest = Array<TextureManifestEntry>();
				for (const skin of skins) {
					// Abort if the export has been cancelled.
					if (helper.isCancelled())
						return;

					const skinData = await casc.getFile(skin.fileDataID);

					let skinFile;
					if (config.enableSharedChildren)
						skinFile = ExportHelper.getExportPath(skin.fileName);
					else
						skinFile = path.join(outDir, path.basename(skin.fileName));

					await skinData.writeToFile(skinFile);
					skinsManifest.push({ fileDataID: skin.fileDataID, file: path.relative(outDir, skinFile) });
				}

				manifest.addProperty(manifestName, skinsManifest);
			};

			await exportSkins(this.m2.getSkinList(), 'SKIN', 'skins');
			await exportSkins(this.m2.lodSkins, 'LOD_SKIN', 'lodSkins');
		}

		// Write relative skeleton files.
		if (config.modelsExportSkel && this.m2.skeletonFileID) {
			const skelData = await casc.getFile(this.m2.skeletonFileID);
			const skelFileName = Listfile.getByID(this.m2.skeletonFileID);

			let skelFile: string;
			if (config.enableSharedChildren)
				skelFile = ExportHelper.getExportPath(skelFileName);
			else
				skelFile = path.join(outDir, path.basename(skelFileName));

			await skelData.writeToFile(skelFile);
			manifest.addProperty('skeleton', { fileDataID: this.m2.skeletonFileID, file: path.relative(outDir, skelFile) });
		}

		// Write relative bone files.
		if (config.modelsExportBone && this.m2.boneFileIDs) {
			const boneManifest = [];
			for (let i = 0, n = this.m2.boneFileIDs.length; i < n; i++) {
				const boneFileID = this.m2.boneFileIDs[i];
				const boneData = await casc.getFile(boneFileID);
				const boneFileName = Listfile.getByIDOrUnknown(boneFileID, '.bone');

				let boneFile;
				if (config.enableSharedChildren)
					boneFile = ExportHelper.getExportPath(boneFileName);
				else
					boneFile = path.join(outDir, path.basename(boneFileName));

				await boneData.writeToFile(boneFile);
				boneManifest.push({ fileDataID: boneFileID, file: path.relative(outDir, boneFile) });
			}

			manifest.addProperty('bones', boneManifest);
		}

		// Write relative animation files.
		if (config.modelsExportAnim && this.m2.animFileIDs) {
			const animManifest = [];
			const animCache = new Set();
			for (const anim of this.m2.animFileIDs) {
				if (anim.fileDataID > 0 && !animCache.has(anim.fileDataID)) {
					const animData = await casc.getFile(anim.fileDataID);
					const animFileName = Listfile.getByIDOrUnknown(anim.fileDataID, '.anim');

					let animFile;
					if (config.enableSharedChildren)
						animFile = ExportHelper.getExportPath(animFileName);
					else
						animFile = path.join(outDir, path.basename(animFileName));

					await animData.writeToFile(animFile);
					animManifest.push({ fileDataID: anim.fileDataID, file: path.relative(outDir, animFile), animID: anim.animID, subAnimID: anim.subAnimID });
					animCache.add(anim.fileDataID);
				}
			}

			manifest.addProperty('anims', animManifest);
		}

		await manifest.write();
	}
}