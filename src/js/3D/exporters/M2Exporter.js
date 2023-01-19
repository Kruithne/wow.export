/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');
const path = require('path');
const generics = require('../../generics');
const listfile = require('../../casc/listfile');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const JSONWriter = require('../writers/JSONWriter');
const GLTFWriter = require('../writers/GLTFWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');

class M2Exporter {
	/**
	 * Construct a new M2Exporter instance.
	 * @param {BufferWrapper}
	 * @param {Array} variantTextures
	 * @param {number} fileDataID
	 */
	constructor(data, variantTextures, fileDataID) {
		this.m2 = new M2Loader(data);
		this.fileDataID = fileDataID;
		this.variantTextures = variantTextures;
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param {Array} mask
	 */
	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	/**
	 * Export the textures for this M2 model.
	 * @param {string} out
	 * @param {boolean} raw
	 * @param {MTLWriter} mtl
	 * @param {ExportHelper} helper
	 * @param {boolean} [fullTexPaths=false]
	 * @returns {Map<number, string>}
	 */
	async exportTextures(out, raw = false, mtl = null, helper, fullTexPaths = false) {
		const config = core.view.config;
		const validTextures = new Map();

		if (!config.modelsExportTextures)
			return validTextures;

		await this.m2.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';

		let textureIndex = 0;
		for (const texture of this.m2.textures) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

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
					let fileName = listfile.getByID(texFileDataID);

					if (fileName !== undefined) {
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');

						// Remove spaces from material name for MTL compatibility.
						if (core.view.config.removePathSpaces)
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
							fileName = listfile.formatUnknownFile(texFile);
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = path.relative(out, texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);

						if (raw === true) {
							// Write raw BLP files.
							await data.writeToFile(texPath);
						} else {
							// Convert BLP to PNG.
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha? 0b1111 : 0b0111);
						}
					} else {
						log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
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
					log.write('Failed to export texture %d for M2: %s', texFileDataID, e.message);
				}
			}

			textureIndex++;
		}

		return validTextures;
	}

	async exportAsGLTF(out, helper) {
		const outGLTF = ExportHelper.replaceExtension(out, '.gltf');
		const outDir = path.dirname(out);

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && generics.fileExists(outGLTF))
			return log.write('Skipping GLTF export of %s (already exists, overwrite disabled)', outGLTF);

		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const gltf = new GLTFWriter(out, this.m2.name);
		log.write('Exporting M2 model %s as GLTF: %s', this.m2.name, outGLTF);

		gltf.setVerticesArray(this.m2.vertices);
		gltf.setNormalArray(this.m2.normals);
		gltf.setUVArray(this.m2.uv);
		gltf.setBoneWeightArray(this.m2.boneWeights);
		gltf.setBoneIndiceArray(this.m2.boneIndices);
		gltf.setBonesArray(this.m2.bones);

		// TODO: Handle UV2 for GLTF.

		// TODO: full texture paths.
		const textureMap = await this.exportTextures(outDir, false, null, helper, true);
		gltf.setTextureMap(textureMap);

		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			// Skip geosets that are not enabled.
			if (!this.geosetMask[mI]?.checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const indices = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				indices[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			let texture = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit)
				texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

			// TODO: Better material naming.
			let matName;
			if (texture?.fileDataID > 0 && textureMap.has(texture.fileDataID))
				matName = texture.fileDataID;

			gltf.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), indices, matName);
		}

		await gltf.write(core.view.config.overwriteFiles);
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, exportCollision = false, helper, fileManifest) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = core.view.config;
		const exportMeta = core.view.config.exportM2Meta;
		const exportBones = core.view.config.exportM2Bones;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = path.dirname(out);

		log.write('Exporting M2 model %s as OBJ: %s', this.m2.name, out);

		// Use internal M2 name for object.
		obj.setName(this.m2.name);

		// Verts, normals, UVs
		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.addUVArray(this.m2.uv);

		if (core.view.config.modelsExportUV2)
			obj.addUVArray(this.m2.uv2);

		// Textures
		const validTextures = await this.exportTextures(outDir, false, mtl, helper);
		for (const [texFileDataID, texInfo] of validTextures)
			fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texInfo.matPath });

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
					fileNameInternal: listfile.getByID(texture.fileDataID),
					fileNameExternal: textureEntry?.matPathRelative,
					mtlName: textureEntry?.matName
				}, texture);
			}

			json.addProperty('fileDataID', this.fileDataID);
			json.addProperty('fileName', listfile.getByID(this.fileDataID));
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
			fileManifest?.push({ type: 'META', fileDataID: this.fileDataID, file: json.out });
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

			let texture = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit)
				texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

			let matName;
			if (texture?.fileDataID > 0 && validTextures.has(texture.fileDataID))
				matName = validTextures.get(texture.fileDataID).matName;

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', fileDataID: this.fileDataID, file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', fileDataID: this.fileDataID, file: mtl.out });

		if (exportCollision) {
			const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices);

			await phys.write(config.overwriteFiles);
			fileManifest?.push({ type: 'PHYS_OBJ', fileDataID: this.fileDataID, file: phys.out });
		}
	}

	/**
	 * Export the model as a raw M2 file, including related files
	 * such as textures, bones, animations, etc.
	 * @param {string} out
	 * @param {ExportHelper} helper
	 * @param {Array} [fileManifest]
	 */
	async exportRaw(out, helper, fileManifest) {
		const casc = core.view.casc;
		const config = core.view.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.fileDataID);

		// Write the M2 file with no conversion.
		await this.m2.data.writeToFile(out);
		fileManifest?.push({ type: 'M2', fileDataID: this.fileDataID, file: out });

		// Only load M2 data if we need to export related files.
		if (config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone || config.modelsExportAnim)
			await this.m2.load();

		// Directory that relative files should be exported to.
		const outDir = path.dirname(out);

		// Write relative skin files.
		if (config.modelsExportSkin) {
			const textures = await this.exportTextures(outDir, true, null, helper);
			const texturesManifest = [];
			for (const [texFileDataID, texInfo] of textures) {
				texturesManifest.push({ fileDataID: texFileDataID, file: path.relative(outDir, texInfo.matPath) });
				fileManifest?.push({ type: 'BLP', fileDataID: texFileDataID, file: texInfo.matPath });
			}

			manifest.addProperty('textures', texturesManifest);

			const exportSkins = async (skins, typeName, manifestName) => {
				const skinsManifest = [];
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
					fileManifest?.push({ type: typeName, fileDataID: skin.fileDataID, file: skinFile });
				}

				manifest.addProperty(manifestName, skinsManifest);
			};

			await exportSkins(this.m2.getSkinList(), 'SKIN', 'skins');
			await exportSkins(this.m2.lodSkins, 'LOD_SKIN', 'lodSkins');
		}

		// Write relative skeleton files.
		if (config.modelsExportSkel && this.m2.skeletonFileID) {
			const skelData = await casc.getFile(this.m2.skeletonFileID);
			const skelFileName = listfile.getByID(this.m2.skeletonFileID);

			let skelFile;
			if (config.enableSharedChildren)
				skelFile = ExportHelper.getExportPath(skelFileName);
			else
				skelFile = path.join(outDir, path.basename(skelFileName));

			await skelData.writeToFile(skelFile);
			manifest.addProperty('skeleton', { fileDataID: this.m2.skeletonFileID, file: path.relative(outDir, skelFile) });
			fileManifest?.push({ type: 'SKEL', fileDataID: this.m2.skeletonFileID, file: skelFile });
		}

		// Write relative bone files.
		if (config.modelsExportBone && this.m2.boneFileIDs) {
			const boneManifest = [];
			for (let i = 0, n = this.m2.boneFileIDs.length; i < n; i++) {
				const boneFileID = this.m2.boneFileIDs[i];
				const boneData = await casc.getFile(boneFileID);
				const boneFileName = listfile.getByIDOrUnknown(boneFileID, '.bone');

				let boneFile;
				if (config.enableSharedChildren)
					boneFile = ExportHelper.getExportPath(boneFileName);
				else
					boneFile = path.join(outDir, path.basename(boneFileName));

				await boneData.writeToFile(boneFile);
				boneManifest.push({ fileDataID: boneFileID, file: path.relative(outDir, boneFile) });
				fileManifest?.push({ type: 'BONE', fileDataID: boneFileID, file: boneFile });
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
					const animFileName = listfile.getByIDOrUnknown(anim.fileDataID, '.anim');

					let animFile;
					if (config.enableSharedChildren)
						animFile = ExportHelper.getExportPath(animFileName);
					else
						animFile = path.join(outDir, path.basename(animFileName));

					await animData.writeToFile(animFile);
					animManifest.push({ fileDataID: anim.fileDataID, file: path.relative(outDir, animFile), animID: anim.animID, subAnimID: anim.subAnimID });
					fileManifest?.push({ type: 'ANIM', fileDataID: anim.fileDataID, file: animFile });
					animCache.add(anim.fileDataID);
				}
			}

			manifest.addProperty('anims', animManifest);
		}

		await manifest.write();
	}
}

module.exports = M2Exporter;