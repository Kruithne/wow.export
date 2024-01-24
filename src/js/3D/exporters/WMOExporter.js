/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');
const listfile = require('../../casc/listfile');
const path = require('path');
const generics = require('../../generics');

const BLPFile = require('../../casc/blp');
const WMOLoader = require('../loaders/WMOLoader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const CSVWriter = require('../writers/CSVWriter');
const GLTFWriter = require('../writers/GLTFWriter');
const JSONWriter = require('../writers/JSONWriter');
const ExportHelper = require('../../casc/export-helper');
const M2Exporter = require('./M2Exporter');

const doodadCache = new Set();

class WMOExporter {
	/**
	 * Construct a new WMOExporter instance.
	 * @param {BufferWrapper} data
	 * @param {string|number} fileID
	 */
	constructor(data, fileID) {
		this.wmo = new WMOLoader(data, fileID);
	}

	/**
	 * Set the mask used for group control.
	 * @param {Array} mask 
	 */
	setGroupMask(mask) {
		this.groupMask = mask;
	}

	/**
	 * Set the mask used for doodad set control.
	 */
	setDoodadSetMask(mask) {
		this.doodadSetMask = mask;
	}

	/**
	 * Export textures for this WMO.
	 * @param {string} out 
	 * @param {?MTLWriter} mtl 
	 * @param {ExportHelper}
	 * @param {boolean} [raw=false]
	 * @returns {{ textureMap: Map, materialMap: Map }}
	 */
	async exportTextures(out, mtl = null, helper, raw = false) {
		const config = core.view.config;
		const casc = core.view.casc;

		const textureMap = new Map();
		const materialMap = new Map();

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
				return;

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
					fileDataID = listfile.getByFilename(fileName) ?? 0;

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
					let texPath = path.join(path.dirname(out), texFile);

					// Default MTl name to the file ID (prefixed for Maya).
					let matName = 'mat_' + fileDataID;

					// Attempt to get the file name if we don't already have it.
					if (fileName === undefined)
						fileName = listfile.getByID(fileDataID);

					// If we have a valid file name, use it for the material name.
					if (fileName !== undefined) {
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');
						
						// Remove spaces from material name for MTL compatibility.
						if (core.view.config.removePathSpaces)
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
							fileName = listfile.formatUnknownFile(texFile);
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = path.relative(path.dirname(out), texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await casc.getFile(fileDataID);

						log.write('Exporting WMO texture %d -> %s', fileDataID, texPath);
						if (raw) {
							await data.writeToFile(texPath);
						} else {
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111); // material.blendMode !== 0
						}
					} else {
						log.write('Skipping WMO texture export %s (file exists, overwrite disabled)', texPath);
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
					log.write('Failed to export texture %d for WMO: %s', fileDataID, e.message);
				}
			}
		}

		return { textureMap, materialMap };
	}

	/**
	 * Export the WMO model as a GLTF file.
	 * @param {string} out 
	 * @param {ExportHelper} helper 
	 */
	async exportAsGLTF(out, helper) {
		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && generics.fileExists(out))
			return log.write('Skipping GLTF export of %s (already exists, overwrite disabled)', out);

		const wmo_name = path.basename(out, '.gltf');
		const gltf = new GLTFWriter(out, wmo_name);

		const groupMask = this.groupMask;

		log.write('Exporting WMO model %s as GLTF: %s', wmo_name, out);

		await this.wmo.load();

		helper.setCurrentTaskName(wmo_name + ' textures');
		const texMaps = await this.exportTextures(out, null, helper);

		if (helper.isCancelled())
			return;

		const gltf_texture_lookup = new Map();
		const texture_map_fids = [...texMaps.textureMap.keys()];
		for (let i = 0; i < texture_map_fids.length; i++)
			gltf_texture_lookup.set(i, texture_map_fids[i]);

		gltf.setTextureMap(texMaps.textureMap);

		const groups = [];
		let nInd = 0;

		let mask;

		// Map our user-facing group mask to a WMO mask.
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked) {
					// Add the group index to the mask.
					mask.add(group.groupIndex);
				}
			}
		}

		// Iterate over the groups once to calculate the total size of our
		// vertex/normal/uv arrays allowing for pre-allocation.
		for (let i = 0, n = this.wmo.groupCount; i < n; i++) {
			const group = await this.wmo.getGroup(i);

			// Skip empty groups.
			if (!group.renderBatches?.length)
				continue;

			// Skip masked groups.
			if (!mask?.has(i))
				continue;

			// 3 vertices per indices.
			nInd += group.vertices.length / 3;

			// Store the valid groups for quicker iteration later.
			groups.push(group);
		}

		const vertices = new Array(nInd * 3);
		const normals = new Array(nInd * 3);

		const uv_maps = [];

		// Iterate over groups again and fill the allocated arrays.
		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.vertices.length / 3;

			const vertOfs = indOfs * 3;
			const groupVertices = group.vertices;
			for (let i = 0, n = groupVertices.length; i < n; i++)
				vertices[vertOfs + i] = groupVertices[i];

			// Normal and vertices should match, so reuse vertOfs here.
			const groupNormals = group.normals;
			for (let i = 0, n = groupNormals.length; i < n; i++)
				normals[vertOfs + i] = groupNormals[i];

			const uv_ofs = indOfs * 2;

			if (group.uvs) {
				for (let i = 0, n = group.uvs.length; i < n; i++) {
					if (!uv_maps[i])
						uv_maps[i] = new Array(indCount * 2).fill(0);

					const uv = group.uvs[i];
					const uv_map = uv_maps[i];
					for (let i = 0, n = uv.length; i < n; i++)
						uv_map[uv_ofs + i] = uv[i];
				}
			} else {
				// No UVs available for the mesh, zero fill.
				const uv_count = indCount * 2;
				for (let i = 0; i < uv_count; i++)
					uv_maps[0][uv_ofs + i] = 0;
			}

			const groupName = this.wmo.groupNames[group.nameOfs];

			// Load all render batches into the mesh.
			for (let bI = 0, bC = group.renderBatches.length; bI < bC; bI++) {
				const batch = group.renderBatches[bI];
				const indices = new Array(batch.numFaces);

				for (let i = 0; i < batch.numFaces; i++)
					indices[i] = group.indices[batch.firstFace + i] + indOfs;

				const matID = batch.flags === 2 ? batch.possibleBox2[2] : batch.materialID;
				gltf.addMesh(groupName + bI, indices, gltf_texture_lookup.get(matID));
			}

			indOfs += indCount;
		}

		gltf.setVerticesArray(vertices);
		gltf.setNormalArray(normals);
		
		for (const uv_map of uv_maps)
			gltf.addUVArray(uv_map);

		// TODO: Add support for exporting doodads inside a GLTF WMO.

		await gltf.write(core.view.config.overwriteFiles);
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, helper, fileManifest) {
		const casc = core.view.casc;
		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const config = core.view.config;

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmoName = path.basename(out, '.obj');
		obj.setName(wmoName);

		log.write('Exporting WMO model %s as OBJ: %s', wmoName, out);

		const wmo = this.wmo;
		await wmo.load();

		helper.setCurrentTaskName(wmoName + ' textures');

		const texMaps = await this.exportTextures(out, mtl, helper);

		if (helper.isCancelled())
			return;
			
		const materialMap = texMaps.materialMap;
		const textureMap = texMaps.textureMap;

		for (const [texFileDataID, texInfo] of textureMap)
			fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texInfo.matPath });

		const groups = [];
		let nInd = 0;
		let maxLayerCount = 0;

		let mask;

		// Map our user-facing group mask to a WMO mask.
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked) {
					// Add the group index to the mask.
					mask.add(group.groupIndex);
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
		if (!core.view.config.modelsExportUV2)
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

			const groupName = wmo.groupNames[group.nameOfs];

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
		if (config.overwriteFiles || !await generics.fileExists(csvPath)) {
			const useAbsolute = core.view.config.enableAbsoluteCSVPaths;
			const usePosix = core.view.config.pathFormat === 'posix';
			const outDir = path.dirname(out);
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
				log.write('Exporting WMO doodad set %s with %d doodads...', set.name, count);

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
						fileName = listfile.getByID(fileDataID);
					} else {
						// Classic, use fileName and lookup the fileDataID.
						fileName = wmo.doodadNames[doodad.offset];
						fileDataID = listfile.getByFilename(fileName) || 0;
					}
		
					if (fileDataID > 0) {
						try {
							if (fileName !== undefined) {
								// Replace M2 extension with OBJ.
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								// Handle unknown files.
								fileName = listfile.formatUnknownFile(fileDataID, '.obj');
							}

							let m2Path;
							if (core.view.config.enableSharedChildren)
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

							let modelPath = path.relative(outDir, m2Path);

							if (useAbsolute === true)
								modelPath = path.resolve(outDir, modelPath);

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
							log.write('Failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
						}
					}
				}
			}

			await csv.write();
			fileManifest?.push({ type: 'PLACEMENT', fileDataID: this.wmo.fileDataID, file: csv.out });
		} else {
			log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', fileDataID: this.wmo.fileDataID, file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', fileDataID: this.wmo.fileDataID, file: mtl.out });

		if (core.view.config.exportWMOMeta) {
			helper.clearCurrentTask();
			helper.setCurrentTaskName(wmoName + ', writing meta data');

			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));
			json.addProperty('fileType', 'wmo');
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
					groupName: wmo.groupNames[group.nameOfs],
					groupDescription: wmo.groupNames[group.descOfs],
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
			const textures = [];
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
						fileNameInternal: listfile.getByID(materialTexture),
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
			fileManifest?.push({ type: 'META', fileDataID: this.wmo.fileDataID, file: json.out });
		}
	}

	/**
	 * 
	 * @param {string} out 
	 * @param {ExportHelper} helper 
	 * @param {Array} [fileManifest]
	 */
	async exportRaw(out, helper, fileManifest) {
		const casc = core.view.casc;
		const config = core.view.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.wmo.fileDataID);

		// Write the raw WMO file with no conversion.
		await this.wmo.data.writeToFile(out);
		fileManifest?.push({ type: 'WMO', fileDataID: this.wmo.fileDataID, file: out });

		await this.wmo.load();

		// Export raw textures.
		const textures = await this.exportTextures(out, null, helper, true);
		const texturesManifest = [];
		for (const [texFileDataID, texInfo] of textures.textureMap) {
			fileManifest?.push({ type: 'BLP', fileDataID: texFileDataID, file: texInfo.matPath });
			texturesManifest.push({ fileDataID: texFileDataID, file: path.relative(out, texInfo.matPath) });
		}

		manifest.addProperty('textures', texturesManifest);

		if (config.modelsExportWMOGroups) {
			const groupManifest = [];
			const wmoFileName = this.wmo.fileName;
			for (let i = 0, n = this.wmo.groupCount; i < n; i++) {
				// Abort if the export has been cancelled.
				if (helper.isCancelled())
					return;

				const groupName = ExportHelper.replaceExtension(wmoFileName, '_' + i.toString().padStart(3, '0') + '.wmo');
				const groupFileDataID = this.wmo.groupIDs?.[i] ?? listfile.getByFilename(groupName);
				const groupData = await casc.getFile(groupFileDataID);

				let groupFile;
				if (config.enableSharedChildren)
					groupFile = ExportHelper.getExportPath(groupName);
				else
					groupFile = path.join(out, path.basename(groupName));

				await groupData.writeToFile(groupFile);

				fileManifest?.push({ type: 'WMO_GROUP', fileDataID: groupFileDataID, file: groupFile });
				groupManifest.push({ fileDataID: groupFileDataID, file: path.relative(out, groupFile) });
			}

			manifest.addProperty('groups', groupManifest);
		}

		await manifest.write();
	}

	/**
	 * Clear the WMO exporting cache.
	 */
	static clearCache() {
		doodadCache.clear();
	}
}

module.exports = WMOExporter;