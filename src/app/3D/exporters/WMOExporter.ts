/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { fileExists } from '../../generics';

import Log from '../../log';
import Listfile from '../../casc/listfile';
import Path from 'path';
import State from '../../state';

import BufferWrapper from '../../buffer';

import BLPFile from '../../casc/blp';
import WMOLoader from '../loaders/WMOLoader';
import OBJWriter from '../writers/OBJWriter';
import MTLWriter from '../writers/MTLWriter';
import CSVWriter from '../writers/CSVWriter';
import JSONWriter from '../writers/JSONWriter';
import ExportHelper from '../../casc/export-helper';
import M2Exporter from './M2Exporter';

import WMOEntry from '../renderers/WMOEntry';
import { WMOGroupLoader } from '../loaders/WMOLoader';

type WMOTextureManifestEntry = {
	fileDataID: number,
	file: string
}

type WMOTextures = {
	textureMap: Map<number, WMOTextureEntry>;
	materialMap: Map<number, string>;
}

type WMOTextureEntry = {
	matPathRelative: string;
	matPath: string;
	matName: string;
}

type WMOTextureMap = {
	fileDataID: number,
	fileNameInternal?: string,
	fileNameExternal?: string
	mtlName?: string
};

const doodadCache = new Set();

export default class WMOExporter {
	wmo: WMOLoader;
	groupMask: Array<WMOEntry>;
	doodadSetMask: Array<WMOEntry>;

	/**
	 * Construct a new WMOExporter instance.
	 * @param data
	 * @param fileID
	 */
	constructor(data: BufferWrapper, fileID: string | number) {
		this.wmo = new WMOLoader(data, fileID);
	}

	/**
	 * Set the mask used for group control.
	 * @param mask - Array of WMOEntry objects.
	 */
	setGroupMask(mask: Array<WMOEntry>): void {
		this.groupMask = mask;
	}

	/**
	 * Set the mask used for doodad set control.
	 * @param mask - Array of WMOEntry objects.
	 */
	setDoodadSetMask(mask: Array<WMOEntry>): void {
		this.doodadSetMask = mask;
	}

	/**
	 * Export textures for this WMO.
	 * @param out - Output directory.
	 * @param mtl - MTLWriter instance.
	 * @param helper - ExportHelper instance.
	 */
	async exportTextures(out: string, mtl: MTLWriter | null = null, helper: ExportHelper, raw: boolean = false): Promise<WMOTextures> {
		const config = State.state.config;
		const casc = State.state.casc;

		const textureMap = new Map<number, WMOTextureEntry>();
		const materialMap = new Map<number, string>();

		if (!config.modelsExportTextures)
			return { textureMap, materialMap };

		// Ensure the WMO is loaded before reading materials.
		await this.wmo.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';
		const isClassic = !!this.wmo.textureNames;
		const materialCount = this.wmo.materials.length;

		helper.setCurrentTaskMax(materialCount);

		for (let i = 0; i < materialCount; i++) {
			if (helper.isCancelled())
				return { textureMap, materialMap };

			const material = this.wmo.materials[i];
			helper.setCurrentTaskValue(i);

			const materialTextures = [material.texture1, material.texture2, material.texture3];

			// Variable that purely exists to not handle the first texture as the main one for shader23
			let dontUseFirstTexture = false;

			if (material.shader == 23) {
				materialTextures.push(material.flags3);
				materialTextures.push(material.color3);
				materialTextures.push(material.runtimeData[0]);
				materialTextures.push(material.runtimeData[1]);
				materialTextures.push(material.runtimeData[2]);
				materialTextures.push(material.runtimeData[3]);

				dontUseFirstTexture = true;
			}

			for (const materialTexture of materialTextures) {
				// Skip unused material slots.
				if (materialTexture === 0)
					continue;

				let fileDataID = 0;
				let fileName;

				if (isClassic) {
					// Classic, lookup fileDataID using file name.
					fileName = this.wmo.textureNames[materialTexture];
					fileDataID = Listfile.getByFilename(fileName) ?? 0;

					// Remove all whitespace from exported textures due to MTL incompatibility.
					if (config.removePathSpaces)
						fileName = fileName.replace(/\s/g, '');
				} else {
					// Retail, use fileDataID directly.
					fileDataID = materialTexture;
				}

				// Skip unknown/missing files.
				if (fileDataID === 0)
					continue;

				try {
					let texFile = fileDataID + (raw ? '.blp' : '.png');
					let texPath = Path.join(Path.dirname(out), texFile);

					// Default MTl name to the file ID (prefixed for Maya).
					let matName = 'mat_' + fileDataID;

					// Attempt to get the file name if we don't already have it.
					if (fileName === undefined)
						fileName = Listfile.getByID(fileDataID);

					// If we have a valid file name, use it for the material name.
					if (fileName !== undefined) {
						matName = 'mat_' + Path.basename(fileName.toLowerCase(), '.blp');

						// Remove spaces from material name for MTL compatibility.
						if (State.state.config.removePathSpaces)
							matName = matName.replace(/\s/g, '');
					}

					// Map texture files relative to shared directory.
					if (config.enableSharedTextures) {
						if (fileName !== undefined) {
							// Replace BLP extension with PNG.
							if (raw === false)
								fileName = ExportHelper.replaceExtension(fileName, '.png');
						} else {
							// Handle unknown files.
							fileName = Listfile.formatUnknownFile(fileDataID);
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = Path.relative(Path.dirname(out), texPath);
					}

					if (config.overwriteFiles || !await fileExists(texPath)) {
						const data = await casc.getFile(fileDataID);

						Log.write('Exporting WMO texture %d -> %s', fileDataID, texPath);
						if (raw) {
							await data.writeToFile(texPath);
						} else {
							const blp = new BLPFile(data);
							await blp.toPNG(useAlpha ? 0b1111 : 0b0111).writeToFile(texPath); // material.blendMode !== 0
						}
					} else {
						Log.write('Skipping WMO texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					mtl?.addMaterial(matName, texFile);
					textureMap.set(fileDataID, { matPathRelative: texFile, matPath: texPath, matName });

					// MTL only supports one texture per material, only link the first unless we only want the second one (e.g. for shader 23).
					if (!materialMap.has(i) && dontUseFirstTexture == false)
						materialMap.set(i, matName);

					// Unset skip here so we always pick the next texture in line
					dontUseFirstTexture = false;
				} catch (e) {
					Log.write('Failed to export texture %d for WMO: %s', fileDataID, e.message);
				}
			}
		}

		return { textureMap, materialMap };
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param out
	 * @param helper
	 */
	async exportAsOBJ(out: string, helper: ExportHelper): Promise<void> {
		const casc = State.state.casc;
		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const config = State.state.config;

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmoName = Path.basename(out, '.obj');
		obj.setName(wmoName);

		Log.write('Exporting WMO model %s as OBJ: %s', wmoName, out);

		const wmo = this.wmo;
		await wmo.load();

		helper.setCurrentTaskName(wmoName + ' textures');

		const texMaps = await this.exportTextures(out, mtl, helper);

		if (helper.isCancelled())
			return;

		const materialMap = texMaps.materialMap;
		const textureMap = texMaps.textureMap;

		const groups = Array<WMOGroupLoader>();
		let nInd = 0;
		let maxLayerCount = 0;

		let mask;

		// Map our user-facing group mask to a WMO mask.
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked) {
					// Add the group index to the mask.
					mask.add(group.index);
				}
			}
		}

		helper.setCurrentTaskName(wmoName + ' groups');
		helper.setCurrentTaskMax(wmo.groupCount);

		// Iterate over the groups once to calculate the total size of our
		// vertex/normal/uv arrays allowing for pre-allocation.
		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			helper.setCurrentTaskValue(i);

			const group = await wmo.getGroup(i);

			// Skip empty groups.
			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			// Skip masked groups.
			if (mask && !mask.has(i))
				continue;

			// 3 verts per indices.
			nInd += group.vertices.length / 3;

			// UV counts vary between groups, allocate for the max.
			maxLayerCount = Math.max(group.uvs.length, maxLayerCount);

			// Store the valid groups for quicker iteration later.
			groups.push(group);
		}

		// Restrict to first UV layer if additional UV layers are not enabled.
		if (!State.state.config.modelsExportUV2)
			maxLayerCount = Math.min(maxLayerCount, 1);

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);
		const uvArrays = new Array(maxLayerCount);

		// Create all necessary UV layer arrays.
		for (let i = 0; i < maxLayerCount; i++)
			uvArrays[i] = new Array(nInd * 2);

		// Iterate over groups again and fill the allocated arrays.
		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.vertices.length / 3;

			const vertOfs = indOfs * 3;
			const groupVerts = group.vertices;
			for (let i = 0, n = groupVerts.length; i < n; i++)
				vertsArray[vertOfs + i] = groupVerts[i];

			// Normals and vertices should match, so re-use vertOfs here.
			const groupNormals = group.normals;
			for (let i = 0, n = groupNormals.length; i < n; i++)
				normalsArray[vertOfs + i] = groupNormals[i];

			const uvsOfs = indOfs * 2;
			const groupUVs = group.uvs ?? [];
			const uvCount = indCount * 2;

			// Write to all UV layers, even if we have no data.
			for (let i = 0; i < maxLayerCount; i++) {
				const uv = groupUVs[i];
				for (let j = 0; j < uvCount; j++)
					uvArrays[i][uvsOfs + j] = uv?.[j] ?? 0;
			}

			const groupName = wmo.groupNames.get(group.nameOfs);

			// Load all render batches into the mesh.
			for (let bI = 0, bC = group.renderBatches.length; bI < bC; bI++) {
				const batch = group.renderBatches[bI];
				const indices = new Array(batch.numFaces);

				for (let i = 0; i < batch.numFaces; i++)
					indices[i] = group.indices[batch.firstFace + i] + indOfs;

				const matID = batch.flags === 2 ? batch.possibleBox2[2] : batch.materialID;
				obj.addMesh(groupName + bI, indices, materialMap.get(matID));
			}

			indOfs += indCount;
		}

		obj.setVertArray(vertsArray);
		obj.setNormalArray(normalsArray);

		for (const arr of uvArrays)
			obj.addUVArray(arr);

		const csvPath = ExportHelper.replaceExtension(out, '_ModelPlacementInformation.csv');
		if (config.overwriteFiles || !await fileExists(csvPath)) {
			const useAbsolute = State.state.config.enableAbsoluteCSVPaths;
			const usePosix = State.state.config.pathFormat === 'posix';
			const outDir = Path.dirname(out);
			const csv = new CSVWriter(csvPath);
			csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationW', 'RotationX', 'RotationY', 'RotationZ', 'ScaleFactor', 'DoodadSet', 'FileDataID');

			// Doodad sets.
			const doodadSets = wmo.doodadSets;
			for (let i = 0, n = doodadSets.length; i < n; i++) {
				// Skip disabled doodad sets.
				if (!doodadSetMask?.[i]?.checked)
					continue;

				const set = doodadSets[i];
				const count = set.doodadCount;
				Log.write('Exporting WMO doodad set %s with %d doodads...', set.name, count);

				helper.setCurrentTaskName(wmoName + ', doodad set ' + set.name);
				helper.setCurrentTaskMax(count);

				for (let i = 0; i < count; i++) {
					// Abort if the export has been cancelled.
					if (helper.isCancelled())
						return;

					helper.setCurrentTaskValue(i);

					const doodad = wmo.doodads[set.firstInstanceIndex + i];
					let fileDataID = 0;
					let fileName;

					if (wmo.fileDataIDs) {
						// Retail, use fileDataID and lookup the filename.
						fileDataID = wmo.fileDataIDs[doodad.offset];
						fileName = Listfile.getByID(fileDataID);
					} else {
						// Classic, use fileName and lookup the fileDataID.
						fileName = wmo.doodadNames[doodad.offset];
						fileDataID = Listfile.getByFilename(fileName) || 0;
					}

					if (fileDataID > 0) {
						try {
							if (fileName !== undefined) {
								// Replace M2 extension with OBJ.
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								// Handle unknown files.
								fileName = Listfile.formatUnknownFile(fileDataID, '.obj');
							}

							let m2Path;
							if (State.state.config.enableSharedChildren)
								m2Path = ExportHelper.getExportPath(fileName);
							else
								m2Path = ExportHelper.replaceFile(out, fileName);

							// Only export doodads that are not already exported.
							if (!doodadCache.has(fileDataID)) {
								const data = await casc.getFile(fileDataID);
								const m2Export = new M2Exporter(data, undefined, fileDataID);
								await m2Export.exportAsOBJ(m2Path, false, helper);

								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								doodadCache.add(fileDataID);
							}

							let modelPath = Path.relative(outDir, m2Path);

							if (useAbsolute === true)
								modelPath = Path.resolve(outDir, modelPath);

							if (usePosix)
								modelPath = ExportHelper.win32ToPosix(modelPath);

							csv.addRow({
								ModelFile: modelPath,
								PositionX: doodad.position[0],
								PositionY: doodad.position[1],
								PositionZ: doodad.position[2],
								RotationW: doodad.rotation[3],
								RotationX: doodad.rotation[0],
								RotationY: doodad.rotation[1],
								RotationZ: doodad.rotation[2],
								ScaleFactor: doodad.scale,
								DoodadSet: set.name,
								FileDataID: fileDataID,
							});
						} catch (e) {
							Log.write('Failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
						}
					}
				}
			}

			await csv.write();
		} else {
			Log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(Path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);

		if (State.state.config.exportWMOMeta) {
			helper.clearCurrentTask();
			helper.setCurrentTaskName(wmoName + ', writing meta data');

			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));
			json.addProperty('fileDataID', wmo.fileDataID);
			json.addProperty('fileName', wmo.fileName);
			json.addProperty('version', wmo.version);
			json.addProperty('counts', {
				material: wmo.materialCount,
				group: wmo.groupCount,
				portal: wmo.portalCount,
				light: wmo.lightCount,
				model: wmo.modelCount,
				doodad: wmo.doodadCount,
				set: wmo.setCount,
				lod: wmo.lodCount
			});

			json.addProperty('portalVertices', wmo.portalVertices);
			json.addProperty('portalInfo', wmo.portalInfo);
			json.addProperty('portalMapObjectRef', wmo.mopr);
			json.addProperty('ambientColor', wmo.ambientColor);
			json.addProperty('areaTableID', wmo.areaTableID);
			json.addProperty('boundingBox1', wmo.boundingBox1);
			json.addProperty('boundingBox2', wmo.boundingBox2);
			json.addProperty('fog', wmo.fogs);
			json.addProperty('flags', wmo.flags);

			const groups = Array(wmo.groups.length);
			for (let i = 0, n = wmo.groups.length; i < n; i++) {
				const group = wmo.groups[i];
				groups[i] = {
					groupName: wmo.groupNames.get(group.nameOfs),
					groupDescription: wmo.groupNames.get(group.descOfs),
					enabled: !mask || mask.has(i),
					version: group.version,
					flags: group.flags,
					ambientColor: group.ambientColor,
					boundingBox1: group.boundingBox1,
					boundingBox2: group.boundingBox2,
					numPortals: group.numPortals,
					numBatchesA: group.numBatchesA,
					numBatchesB: group.numBatchesB,
					numBatchesC: group.numBatchesC,
					liquidType: group.liquidType,
					groupID: group.groupID,
					materialInfo: group.materialInfo,
					renderBatches: group.renderBatches,
					vertexColours: group.vertexColours,
					liquid: group.liquid
				};
			}

			// Create a textures array and push every unique fileDataID from the
			// material stack, expanded with file name/path data for external QoL.
			const textures = Array<WMOTextureMap>();
			const textureCache = new Set();
			for (const material of wmo.materials) {
				const materialTextures = [material.texture1, material.texture2, material.texture3];

				if (material.shader == 23) {
					materialTextures.push(material.color3);
					materialTextures.push(material.flags3);
					materialTextures.push(material.runtimeData[0]);
					materialTextures.push(material.runtimeData[1]);
					materialTextures.push(material.runtimeData[2]);
					materialTextures.push(material.runtimeData[3]);
				}

				for (const materialTexture of materialTextures) {
					if (materialTexture === 0 || textureCache.has(materialTexture))
						continue;

					const textureEntry = textureMap.get(materialTexture);

					textureCache.add(materialTexture);
					textures.push({
						fileDataID: materialTexture,
						fileNameInternal: Listfile.getByID(materialTexture),
						fileNameExternal: textureEntry?.matPathRelative,
						mtlName: textureEntry?.matName
					});
				}
			}

			json.addProperty('groups', groups);
			json.addProperty('groupNames', Object.values(wmo.groupNames));
			json.addProperty('groupInfo', wmo.groupInfo);
			json.addProperty('textures', textures);
			json.addProperty('materials', wmo.materials);
			json.addProperty('doodadSets', wmo.doodadSets);
			json.addProperty('fileDataIDs', wmo.fileDataIDs);
			json.addProperty('doodads', wmo.doodads);
			json.addProperty('groupIDs', wmo.groupIDs);

			await json.write(config.overwriteFiles);
		}
	}

	/**
	 *
	 * @param out
	 * @param helper
	 */
	async exportRaw(out: string, helper: ExportHelper): Promise<void> {
		const casc = State.state.casc;
		const config = State.state.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.wmo.fileDataID);

		// Write the raw WMO file with no conversion.
		await this.wmo.data.writeToFile(out);

		await this.wmo.load();

		// Export raw textures.
		const textures = await this.exportTextures(out, null, helper, true);
		const texturesManifest = Array<WMOTextureManifestEntry>();
		for (const [texFileDataID, texInfo] of textures.textureMap)
			texturesManifest.push({ fileDataID: texFileDataID, file: Path.relative(out, texInfo.matPath) });

		manifest.addProperty('textures', texturesManifest);

		if (config.modelsExportWMOGroups) {
			const groupManifest = Array<WMOTextureManifestEntry>();
			const wmoFileName = this.wmo.fileName as string;
			for (let i = 0, n = this.wmo.groupCount; i < n; i++) {
				// Abort if the export has been cancelled.
				if (helper.isCancelled())
					return;

				const groupName = ExportHelper.replaceExtension(wmoFileName, '_' + i.toString().padStart(3, '0') + '.wmo');
				const groupFileDataID = this.wmo.groupIDs?.[i] ?? Listfile.getByFilename(groupName);
				const groupData = await casc.getFile(groupFileDataID);

				let groupFile;
				if (config.enableSharedChildren)
					groupFile = ExportHelper.getExportPath(groupName);
				else
					groupFile = Path.join(out, Path.basename(groupName));

				await groupData.writeToFile(groupFile);
				groupManifest.push({ fileDataID: groupFileDataID, file: Path.relative(out, groupFile) });
			}

			manifest.addProperty('groups', groupManifest);
		}

		await manifest.write();
	}

	/**
	 * Clear the WMO exporting cache.
	 */
	static clearCache(): void {
		doodadCache.clear();
	}
}