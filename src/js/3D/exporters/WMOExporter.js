/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
import generics from '../../generics.js';
import ExportHelper from '../../export-helper.js';
import OBJWriter from '../writers/OBJWriter.js';
import GLTFWriter from '../writers/GLTFWriter.js';
import M3Exporter from './M3Exporter.js';
import core from '../../core.js';
import { listfile } from '../../views/main/rpc.js';
import BLPImage from '../../casc/blp.js';
import WMOLoader from '../loaders/WMOLoader.js';
import MTLWriter from '../writers/MTLWriter.js';
import CSVWriter from '../writers/CSVWriter.js';
import JSONWriter from '../writers/JSONWriter.js';
import M2Exporter from './M2Exporter.js';
import constants from '../../constants.js';
import log from '../../log.js';







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
	 * @param {boolean} [glbMode=false]
	 * @returns {{ textureMap: Map, materialMap: Map, texture_buffers: Map, files_to_cleanup: Array }}
	 */
	async exportTextures(out, mtl = null, helper, raw = false, glbMode = false) {
		const config = core.view.config;
		const casc = core.view.casc;

		const textureMap = new Map();
		const materialMap = new Map();
		const texture_buffers = new Map();
		const files_to_cleanup = [];

		if (!config.modelsExportTextures)
			return { textureMap, materialMap, texture_buffers, files_to_cleanup };

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
					fileDataID = (await listfile.getByFilename(fileName)) ?? 0;

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
					let texPath = out.substring(0, out.lastIndexOf('/')) + '/' + texFile;

					// Default MTl name to the file ID (prefixed for Maya).
					let matName = 'mat_' + fileDataID;

					if (fileName === undefined)
						fileName = await listfile.getByID(fileDataID);

					// If we have a valid file name, use it for the material name.
					if (fileName !== undefined) {
						matName = 'mat_' + fileName.toLowerCase().split('/').pop().replace('.blp', '');
						
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
						texFile = texPath.replace(out.substring(0, out.lastIndexOf('/') + 1), '');
					}

					const file_existed = await generics.fileExists(texPath);

					if (glbMode && !raw) {
						// glb mode: convert to PNG buffer without writing
						const data = await casc.getFile(fileDataID);
						const blp = new BLPImage(data);
						const png_buffer = blp.toPNG(useAlpha ? 0b1111 : 0b0111);
						texture_buffers.set(fileDataID, png_buffer);
						log.write('Buffering WMO texture %d for GLB embedding', fileDataID);

						if (!file_existed)
							files_to_cleanup.push(texPath);
					} else if (config.overwriteFiles || !file_existed) {
						const data = await casc.getFile(fileDataID);

						log.write('Exporting WMO texture %d -> %s', fileDataID, texPath);
						if (raw) {
							await data.writeToFile(texPath);
						} else {
							const blp = new BLPImage(data);
							await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111);
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

		return { textureMap, materialMap, texture_buffers, files_to_cleanup };
	}

	/**
	 * Export the WMO model as a GLTF file.
	 * @param {string} out 
	 * @param {ExportHelper} helper 
	 */
	async exportAsGLTF(out, helper, format = 'gltf') {
		const ext = format === 'glb' ? '.glb' : '.gltf';
		const outFile = ExportHelper.replaceExtension(out, ext);

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && await generics.fileExists(outFile))
			return log.write('Skipping %s export of %s (already exists, overwrite disabled)', format.toUpperCase(), outFile);

		const wmo_name = outFile.split('/').pop().replace(ext, '');
		const gltf = new GLTFWriter(out, wmo_name);

		const groupMask = this.groupMask;

		log.write('Exporting WMO model %s as %s: %s', wmo_name, format.toUpperCase(), outFile);

		await this.wmo.load();

		helper.setCurrentTaskName(wmo_name + ' textures');
		const texMaps = await this.exportTextures(out, null, helper, false, format === 'glb');

		if (helper.isCancelled())
			return;

		const gltf_texture_lookup = new Map();
		const texture_map_fids = [...texMaps.textureMap.keys()];
		for (let i = 0; i < texture_map_fids.length; i++)
			gltf_texture_lookup.set(i, texture_map_fids[i]);

		gltf.setTextureMap(texMaps.textureMap);
		if (format === 'glb')
			gltf.setTextureBuffers(texMaps.texture_buffers);

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
			if (mask && !mask?.has(i))
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

				const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;
				gltf.addMesh(groupName + bI, indices, texMaps.materialMap.get(matID));
			}

			indOfs += indCount;
		}

		gltf.setVerticesArray(vertices);
		gltf.setNormalArray(normals);
		
		for (const uv_map of uv_maps)
			gltf.addUVArray(uv_map);

		// TODO: Add support for exporting doodads inside a GLTF WMO.

		await gltf.write(core.view.config.overwriteFiles, format);
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, helper, fileManifest, split_groups = false) {
		if (split_groups) {
			await this.exportGroupsAsSeparateOBJ(out, helper, fileManifest);
			return;
		}

		const config = core.view.config;
		const casc = core.view.casc;
		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmoName = out.split('/').pop().replace('.obj', '');
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

				const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;
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
			const outDir = out.substring(0, out.lastIndexOf('/'));
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
						fileDataID = wmo.fileDataIDs[doodad.offset];
						fileName = await listfile.getByID(fileDataID);
					} else {
						fileName = wmo.doodadNames[doodad.offset];
						fileDataID = (await listfile.getByFilename(fileName)) || 0;
					}

					if (fileDataID > 0) {
						try {
							if (fileName !== undefined) {
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
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
								const modelMagic = data.readUInt32LE();
								data.seek(0);
								if (modelMagic == constants.MAGIC.MD21) {
									const m2Export = new M2Exporter(data, undefined, fileDataID);
									await m2Export.exportAsOBJ(m2Path, core.view.config.modelsExportCollision, helper);
								} else if (modelMagic == constants.MAGIC.M3DT) {
									const m3Export = new M3Exporter(data, undefined, fileDataID);
									await m3Export.exportAsOBJ(m2Path, core.view.config.modelsExportCollision, helper);
								}
								
								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								doodadCache.add(fileDataID);
							}

							let modelPath = m2Path.replace(outDir, '');

							if (useAbsolute === true)
								modelPath = outDir + '/' + modelPath;

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
			obj.setMaterialLibrary(mtl.out.split('/').pop());

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
			json.addProperty('wmoID', wmo.wmoID);
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
						fileNameInternal: await listfile.getByID(materialTexture),
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
	 * Export the WMO model as an STL file.
	 * @param {string} out
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsSTL(out, helper, fileManifest) {
		const config = core.view.config;
		const stl = new STLWriter(out);

		const groupMask = this.groupMask;

		const wmoName = out.split('/').pop().replace('.stl', '');
		stl.setName(wmoName);

		log.write('Exporting WMO model %s as STL: %s', wmoName, out);

		const wmo = this.wmo;
		await wmo.load();

		const groups = [];
		let nInd = 0;

		let mask;

		// map our user-facing group mask to a wmo mask
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked)
					mask.add(group.groupIndex);
			}
		}

		helper.setCurrentTaskName(wmoName + ' groups');
		helper.setCurrentTaskMax(wmo.groupCount);

		// iterate over the groups once to calculate the total size
		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			if (helper.isCancelled())
				return;

			helper.setCurrentTaskValue(i);

			const group = await wmo.getGroup(i);

			// skip empty groups
			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			// skip masked groups
			if (mask && !mask.has(i))
				continue;

			// 3 verts per indices
			nInd += group.vertices.length / 3;

			// store the valid groups for quicker iteration later
			groups.push(group);
		}

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);

		// iterate over groups again and fill the allocated arrays
		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.vertices.length / 3;

			const vertOfs = indOfs * 3;
			const groupVerts = group.vertices;
			for (let i = 0, n = groupVerts.length; i < n; i++)
				vertsArray[vertOfs + i] = groupVerts[i];

			// normals and vertices should match, so re-use vertOfs here
			const groupNormals = group.normals;
			for (let i = 0, n = groupNormals.length; i < n; i++)
				normalsArray[vertOfs + i] = groupNormals[i];

			const groupName = wmo.groupNames[group.nameOfs];

			// load all render batches into the mesh
			for (let bI = 0, bC = group.renderBatches.length; bI < bC; bI++) {
				const batch = group.renderBatches[bI];
				const indices = new Array(batch.numFaces);

				for (let i = 0; i < batch.numFaces; i++)
					indices[i] = group.indices[batch.firstFace + i] + indOfs;

				stl.addMesh(groupName + bI, indices);
			}

			indOfs += indCount;
		}

		stl.setVertArray(vertsArray);
		stl.setNormalArray(normalsArray);

		await stl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'STL', fileDataID: this.wmo.fileDataID, file: stl.out });
	}

	/**
	 * export each wmo group as separate obj file
	 * @param {string} out
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportGroupsAsSeparateOBJ(out, helper, fileManifest) {
		const casc = core.view.casc;
		const config = core.view.config;

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmo = this.wmo;
		await wmo.load();

		const wmoName = out.split('/').pop().replace('.obj', '');
		const outDir = out.substring(0, out.lastIndexOf('/'));

		log.write('exporting wmo model %s as split obj: %s', wmoName, out);

		// export textures once, shared across all groups
		helper.setCurrentTaskName(wmoName + ' textures');

		const sharedMTL = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));
		const texMaps = await this.exportTextures(out, sharedMTL, helper);

		if (helper.isCancelled())
			return;

		const textureMap = texMaps.textureMap;
		const materialMap = texMaps.materialMap;

		for (const [texFileDataID, texInfo] of textureMap)
			fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texInfo.matPath });

		// build group mask
		let mask;
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked)
					mask.add(group.groupIndex);
			}
		}

		helper.setCurrentTaskName(wmoName + ' groups');
		helper.setCurrentTaskMax(wmo.groupCount);

		// export each group separately
		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			if (helper.isCancelled())
				return;

			helper.setCurrentTaskValue(i);

			const group = await wmo.getGroup(i);

			// skip empty groups
			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			// skip masked groups
			if (mask && !mask.has(i))
				continue;

			const groupName = wmo.groupNames[group.nameOfs];
			const groupFileName = wmoName + '_' + groupName + '.obj';
			const groupOut = outDir + '/' + groupFileName;

			const obj = new OBJWriter(groupOut);
			obj.setName(groupFileName);

			log.write('exporting wmo group %s: %s', groupName, groupOut);

			// prepare arrays for this group
			const indCount = group.vertices.length / 3;
			const vertsArray = new Array(indCount * 3);
			const normalsArray = new Array(indCount * 3);

			// copy vertices
			const groupVerts = group.vertices;
			for (let j = 0, len = groupVerts.length; j < len; j++)
				vertsArray[j] = groupVerts[j];

			// copy normals
			const groupNormals = group.normals;
			for (let j = 0, len = groupNormals.length; j < len; j++)
				normalsArray[j] = groupNormals[j];

			// handle uv layers
			const groupUVs = group.uvs ?? [];
			const uvCount = indCount * 2;
			const maxLayerCount = config.modelsExportUV2 ? groupUVs.length : Math.min(groupUVs.length, 1);
			const uvArrays = new Array(maxLayerCount);

			for (let j = 0; j < maxLayerCount; j++) {
				uvArrays[j] = new Array(uvCount);
				const uv = groupUVs[j];
				for (let k = 0; k < uvCount; k++)
					uvArrays[j][k] = uv?.[k] ?? 0;
			}

			obj.setVertArray(vertsArray);
			obj.setNormalArray(normalsArray);

			for (const arr of uvArrays)
				obj.addUVArray(arr);

			// add render batches
			for (let bI = 0, bC = group.renderBatches.length; bI < bC; bI++) {
				const batch = group.renderBatches[bI];
				const indices = new Array(batch.numFaces);

				for (let j = 0; j < batch.numFaces; j++)
					indices[j] = group.indices[batch.firstFace + j];

				const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;
				obj.addMesh(groupName + bI, indices, materialMap.get(matID));
			}

			if (!sharedMTL.isEmpty)
				obj.setMaterialLibrary(sharedMTL.out.split('/').pop());

			await obj.write(config.overwriteFiles);
			fileManifest?.push({ type: 'OBJ', fileDataID: this.wmo.fileDataID, file: obj.out });
		}

		// write shared mtl
		await sharedMTL.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', fileDataID: this.wmo.fileDataID, file: sharedMTL.out });

		// export doodad placement csv (shared across all groups)
		const csvPath = ExportHelper.replaceExtension(out, '_ModelPlacementInformation.csv');
		if (config.overwriteFiles || !await generics.fileExists(csvPath)) {
			const useAbsolute = config.enableAbsoluteCSVPaths;
			const usePosix = config.pathFormat === 'posix';
			const csv = new CSVWriter(csvPath);
			csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationW', 'RotationX', 'RotationY', 'RotationZ', 'ScaleFactor', 'DoodadSet', 'FileDataID');

			// doodad sets
			const doodadSets = wmo.doodadSets;
			for (let i = 0, n = doodadSets.length; i < n; i++) {
				if (!doodadSetMask?.[i]?.checked)
					continue;

				const set = doodadSets[i];
				const count = set.doodadCount;
				log.write('exporting wmo doodad set %s with %d doodads...', set.name, count);

				helper.setCurrentTaskName(wmoName + ', doodad set ' + set.name);
				helper.setCurrentTaskMax(count);

				for (let j = 0; j < count; j++) {
					if (helper.isCancelled())
						return;

					helper.setCurrentTaskValue(j);

					const doodad = wmo.doodads[set.firstInstanceIndex + j];
					let fileDataID = 0;
					let fileName;

					if (wmo.fileDataIDs) {
						fileDataID = wmo.fileDataIDs[doodad.offset];
						fileName = await listfile.getByID(fileDataID);
					} else {
						fileName = wmo.doodadNames[doodad.offset];
						fileDataID = (await listfile.getByFilename(fileName)) || 0;
					}

					if (fileDataID > 0) {
						try {
							if (fileName !== undefined) {
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								fileName = listfile.formatUnknownFile(fileDataID, '.obj');
							}

							let m2Path;
							if (config.enableSharedChildren)
								m2Path = ExportHelper.getExportPath(fileName);
							else
								m2Path = ExportHelper.replaceFile(out, fileName);

							if (!doodadCache.has(fileDataID)) {
								const data = await casc.getFile(fileDataID);
								const modelMagic = data.readUInt32LE();
								data.seek(0);
								if (modelMagic == constants.MAGIC.MD21) {
									const m2Export = new M2Exporter(data, undefined, fileDataID);
									await m2Export.exportAsOBJ(m2Path, config.modelsExportCollision, helper);
								} else if (modelMagic == constants.MAGIC.M3DT) {
									const m3Export = new M3Exporter(data, undefined, fileDataID);
									await m3Export.exportAsOBJ(m2Path, config.modelsExportCollision, helper);
								}

								if (helper.isCancelled())
									return;

								doodadCache.add(fileDataID);
							}

							let modelPath = m2Path.replace(outDir, '');

							if (useAbsolute === true)
								modelPath = outDir + '/' + modelPath;

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
							log.write('failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
						}
					}
				}
			}

			await csv.write();
			fileManifest?.push({ type: 'PLACEMENT', fileDataID: this.wmo.fileDataID, file: csv.out });
		} else {
			log.write('skipping model placement export %s (file exists, overwrite disabled)', csvPath);
		}

		// export meta if enabled
		if (config.exportWMOMeta) {
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
			json.addProperty('wmoID', wmo.wmoID);
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
						fileNameInternal: await listfile.getByID(materialTexture),
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
		if (this.wmo.data === undefined)
		{
			const wmoData = await casc.getFile(this.wmo.fileDataID)
			await wmoData.writeToFile(out);
		}
		else
		{
			await this.wmo.data.writeToFile(out);
		}
		
		fileManifest?.push({ type: 'WMO', fileDataID: this.wmo.fileDataID, file: out });

		await this.wmo.load();

		// Export raw textures.
		const textures = await this.exportTextures(out, null, helper, true);
		const texturesManifest = [];
		for (const [texFileDataID, texInfo] of textures.textureMap) {
			fileManifest?.push({ type: 'BLP', fileDataID: texFileDataID, file: texInfo.matPath });
			texturesManifest.push({ fileDataID: texFileDataID, file: texInfo.matPath.replace(out, '') });
		}

		manifest.addProperty('textures', texturesManifest);

		if (config.modelsExportWMOGroups) {
			const groupManifest = [];
			const wmoFileName = this.wmo.fileName;

			const lodCount = this.wmo.groupIDs.length / this.wmo.groupCount;

			let groupOffset = 0;
			for (let lodIndex = 0; lodIndex < lodCount; lodIndex++) {
				for (let groupIndex = 0; groupIndex < this.wmo.groupCount; groupIndex++) {
					// Abort if the export has been cancelled.
					if (helper.isCancelled())
						return;
	
					let groupName;
					if (lodIndex > 0)
						groupName = ExportHelper.replaceExtension(wmoFileName, '_' + groupIndex.toString().padStart(3, '0') + '_lod' + lodIndex + '.wmo');
					else
						groupName = ExportHelper.replaceExtension(wmoFileName, '_' + groupIndex.toString().padStart(3, '0') + '.wmo');
					
					const groupFileDataID = this.wmo.groupIDs?.[groupOffset] ?? await listfile.getByFilename(groupName);
					groupOffset++;

					if (groupFileDataID === 0)
						continue;

					const groupData = await casc.getFile(groupFileDataID);
					
					let groupFile;
					if (config.enableSharedChildren)
						groupFile = ExportHelper.getExportPath(groupName);
					else
						groupFile = out.substring(0, out.lastIndexOf('/')) + '/' + groupName.split('/').pop();
	
					await groupData.writeToFile(groupFile);
	
					fileManifest?.push({ type: 'WMO_GROUP', fileDataID: groupFileDataID, file: groupFile });
					groupManifest.push({ fileDataID: groupFileDataID, file: groupFile.replace(out, '') });
				}
			}

			manifest.addProperty('groups', groupManifest);
		}

		// Doodad sets.
		const doodadSets = this.wmo.doodadSets;
		for (let i = 0, n = doodadSets.length; i < n; i++) {
			const set = doodadSets[i];
			const count = set.doodadCount;
			log.write('Exporting WMO doodad set %s with %d doodads...', set.name, count);

			helper.setCurrentTaskName('Doodad set ' + set.name);
			helper.setCurrentTaskMax(count);

			for (let i = 0; i < count; i++) {
				// Abort if the export has been cancelled.
				if (helper.isCancelled())
					return;

				helper.setCurrentTaskValue(i);

				const doodad = this.wmo.doodads[set.firstInstanceIndex + i];
				let fileDataID = 0;
				let fileName;
	
				if (this.wmo.fileDataIDs) {
					fileDataID = this.wmo.fileDataIDs[doodad.offset];
					fileName = await listfile.getByID(fileDataID);
				} else {
					fileName = this.wmo.doodadNames[doodad.offset];
					fileDataID = (await listfile.getByFilename(fileName)) || 0;
				}
	
				if (fileDataID > 0) {
					try {
						if (fileName === undefined) {
							// Handle unknown files.
							fileName = listfile.formatUnknownFile(fileDataID, '.m2');
						}

						let m2Path;
						if (core.view.config.enableSharedChildren)
							m2Path = ExportHelper.getExportPath(fileName);
						else
							m2Path = ExportHelper.replaceFile(out, fileName);

						// Only export doodads that are not already exported.
						if (!doodadCache.has(fileDataID)) {
							
							const data = await casc.getFile(fileDataID);
							const modelMagic = data.readUInt32LE();
							data.seek(0);
							if (modelMagic == constants.MAGIC.MD21) {
								const m2Export = new M2Exporter(data, undefined, fileDataID);
								await m2Export.exportRaw(m2Path, helper);
							} else if (modelMagic == constants.MAGIC.M3DT) {
								const m3Export = new M3Exporter(data, undefined, fileDataID);
								await m3Export.exportRaw(m2Path, helper);
							}

							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;

							doodadCache.add(fileDataID);
						}
					} catch (e) {
						log.write('Failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
					}
				}
			}
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

export default WMOExporter;