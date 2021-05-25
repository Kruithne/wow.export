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
	 * @returns {{ textureMap: Map, materialMap: Map }}
	 */
	async exportTextures(out, mtl = null, helper) {
		const config = core.view.config;
		const casc = core.view.casc;

		const textureMap = new Map();
		const materialMap = new Map();

		if (!config.modelsExportTextures)
			return { textureMap, materialMap };

		// Ensure the WMO is loaded before reading materials.
		await this.wmo.load();

		const useAlpha = config.modelsExportAlpha;
		const isClassic = !!this.wmo.textureNames;
		const materialCount = this.wmo.materials.length;

		helper.setCurrentTaskMax(materialCount);

		for (let i = 0; i < materialCount; i++) {
			if (helper.isCancelled())
				return;

			const material = this.wmo.materials[i];
			helper.setCurrentTaskValue(i);

			let fileDataID = 0;
			let fileName;

			if (isClassic) {
				// Classic, lookup fileDataID using file name.
				fileName = this.wmo.textureNames[material.texture1];
				fileDataID = listfile.getByFilename(fileName) ?? 0;

				// Remove all whitespace from exported textures due to MTL incompatibility.
				if (config.removePathSpaces)
					fileName = fileName.replace(/\s/g, '');
			} else {
				// Retail, user fileDataID directly.
				fileDataID = material.texture1;
			}

			if (fileDataID > 0) {
				try {
					let texFile = fileDataID + '.png';
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
							fileName = ExportHelper.replaceExtension(fileName, '.png');
						} else {
							// Handle unknown files.
							fileName = 'unknown/' + fileDataID + '.png';
						}

						texPath = ExportHelper.getExportPath(fileName);
						texFile = path.relative(path.dirname(out), texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await casc.getFile(fileDataID);
						const blp = new BLPFile(data);

						log.write('Exporting WMO texture %d -> %s', fileDataID, texPath);
						await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111); // material.blendMode !== 0
					} else {
						log.write('Skipping WMo texture export %s (file exists, overwrite disabled)', texPath);
					}

					mtl?.addMaterial(matName, texFile);
					materialMap.set(i, matName);
					textureMap.set(fileDataID, texFile);
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
		const outGLTF = ExportHelper.replaceExtension(out, '.gltf');
		
		// TODO: Skip overwrite if file exists?

		const wmoName = path.basename(out, '.wmo');
		const gltf = new GLTFWriter(outGLTF, wmoName);

		const groupMask = this.groupMask;

		log.write('Exporting WMO model %s as GLTF: %s', wmoName, outGLTF);

		await this.wmo.load();

		helper.setCurrentTaskName(wmoName + ' textures');
		const texMaps = await this.exportTextures(out, null, helper);

		if (helper.isCancelled())
			return;

		const textureMap = texMaps.textureMap;
		const materialMap = texMaps.materialMap;

		gltf.setTextureMap(textureMap);

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
		const uvs = new Array(nInd * 2);

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

			const uvOfs = indOfs * 2;
			if (group.uvs) {
				// UVs exist, use the first array available.
				const groupUvs = group.uvs[0];
				for (let i = 0, n = groupUvs.length; i < n; i++)
					uvs[uvOfs + i] = groupUvs[i];
			} else {
				// No UVs available for the mesh, zero fill.
				const uvCount = indCount * 2;
				for (let i = 0; i < uvCount; i++)
					uvs[uvOfs + i] = 0;
			}

			const groupName = this.wmo.groupNames[group.nameOfs];

			// Load all render batches into the mesh.
			for (let bI = 0, bC = group.renderBatches.length; bI < bC; bI++) {
				const batch = group.renderBatches[bI];
				const indices = new Array(batch.numFaces);

				for (let i = 0; i < batch.numFaces; i++)
					indices[i] = group.indices[batch.firstFace + i] + indOfs;

				const matID = batch.flags === 2 ? batch.possibleBox2[2] : batch.materialID;
				gltf.addMesh(groupName + bI, indices, materialMap.get(matID));
			}

			indOfs += indCount;
		}

		gltf.setVerticesArray(vertices);
		gltf.setNormalArray(normals);
		gltf.setUVArray(uvs);

		// TODO: Add support for exporting doodads inside a GLTF WMO.

		await gltf.write(core.view.config.overwriteFiles);
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {ExportHelper} helper
	 */
	async exportAsOBJ(out, helper) {
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

			// Store the valid groups for quicker iteration later.
			groups.push(group);
		}

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);
		const uvsArray = new Array(nInd * 2);

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
			if (group.uvs) {
				// UVs exist, use the first array available.
				const groupUvs = group.uvs[0];
				for (let i = 0, n = groupUvs.length; i < n; i++)
					uvsArray[uvsOfs + i] = groupUvs[i];
			} else {
				// No UVs available for the mesh, zero-fill.
				const uvCount = indCount * 2;
				for (let i = 0; i < uvCount; i++)
					uvsArray[uvsOfs + i] = 0;
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
		obj.setUVArray(uvsArray);

		const csvPath = ExportHelper.replaceExtension(out, '_ModelPlacementInformation.csv');
		if (config.overwriteFiles || !await generics.fileExists(csvPath)) {
			const useAbsolute = core.view.config.enableAbsoluteCSVPaths;
			const outDir = path.dirname(out);
			const csv = new CSVWriter(csvPath);
			csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationW', 'RotationX', 'RotationY', 'RotationZ', 'ScaleFactor', 'DoodadSet', 'FileDataID');

			// Doodad sets.
			const doodadSets = wmo.doodadSets;
			for (let i = 0, n = doodadSets.length; i < n; i++) {
				// Skip disabled doodad sets.
				if (doodadSetMask && (!doodadSetMask[i] || !doodadSetMask[i].checked))
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
								fileName = 'unknown/' + fileDataID + '.obj';
							}

							const m2Path = ExportHelper.getExportPath(fileName);

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
		} else {
			log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);

		if (core.view.config.exportWMOMeta) {
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
			json.addProperty('flags', wmo.flags);

			const groups = Array(wmo.groups.length);
			for (let i = 0, n = wmo.groups.length; i < n; i++) {
				const group = wmo.groups[i];
				groups[i] = {
					version: group.version,
					flags: group.flags,
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
					vertexColours: group.vertexColours
				};
			}

			json.addProperty('groups', groups);
			json.addProperty('groupNames', wmo.groupNames);
			json.addProperty('groupInfo', wmo.groupInfo);
			json.addProperty('materials', wmo.materials);
			json.addProperty('doodadSets', wmo.doodadSets);
			json.addProperty('fileDataIDs', wmo.fileDataIDs);
			json.addProperty('doodads', wmo.doodads);
			json.addProperty('groupIDs', wmo.groupIDs);

			await json.write(config.overwriteFiles);
		}
	}

	/**
	 * Clear the WMO exporting cache.
	 */
	static clearCache() {
		doodadCache.clear();
	}
}

module.exports = WMOExporter;