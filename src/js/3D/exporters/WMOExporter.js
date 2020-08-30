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
	 * @param {MTLWriter} mtl
	 * @returns {{ texMap: Map.<number, number>, matMap: Map.<number, number> }}
	 */
	async exportTextures(out, mtl = null) {
		const wmo = this.wmo;
		const config = core.view.config;

		// Ensure the WMO is loaded before reading materials.
		await wmo.load();

		// Textures
		const isClassic = !!wmo.textureNames;
		const materialCount = wmo.materials.length;
		const textureMap = new Map();
		const materialMap = new Map();

		for (let i = 0; i < materialCount; i++) {
			const material = wmo.materials[i];

			let fileDataID;
			let fileName;
			if (isClassic) {
				// Classic, look-up fileDataID using file name.
				fileName = wmo.textureNames[material.texture1];
				fileDataID = listfile.getByFilename(fileName) || 0;

				// Remove all whitespace from exported textures due to MTL incompatibility.
				fileName = fileName.replace(/\s/g, '');
			} else {
				// Retail, use fileDataID directly.
				fileDataID = material.texture1;
			}

			if (fileDataID > 0) {
				try {
					let texFile = fileDataID + '.png';
					let texPath = path.join(path.dirname(out), texFile);

					// Default MTL name to the file ID (prefixed for Maya).
					let matName = 'mat_' + fileDataID;
					
					// We may already have the file name (Classic), if not attempt to get it.
					if (fileName === undefined)
						fileName = listfile.getByID(fileDataID);

					// If we have a valid file name, use it for the material name.
					if (fileName !== undefined)
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');

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
						await blp.saveToPNG(texPath, material.blendMode !== 0);
					} else {
						log.write('Skipping WMO texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (mtl !== null)
						mtl.addMaterial(matName, texFile);

					materialMap.set(i, matName);
					textureMap.set(fileDataID, texFile);
				} catch (e) {
					log.write('Failed to export texture %d for WMO: %s', fileDataID, e.message);
				}
			}
		}

		return { texMap: textureMap, matMap: materialMap };
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param {string} out
	 */
	async exportAsOBJ(out) {
		const casc = core.view.casc;
		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const config = core.view.config;

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmoName = path.basename(out, '.wmo');
		obj.setName(wmoName);

		log.write('Exporting WMO model %s as OBJ: %s', wmoName, out);

		const wmo = this.wmo;
		await wmo.load();

		const texMaps = await this.exportTextures(out, mtl);
		const materialMap = texMaps.texMap;

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
		for (let i = 0, n = wmo.groupCount; i < n; i++) {
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
			csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationW', 'RotationX', 'RotationY', 'RotationZ', 'ScaleFactor', 'DoodadSet');

			// Doodad sets.
			const doodadSets = wmo.doodadSets;
			for (let i = 0, n = doodadSets.length; i < n; i++) {
				// Skip disabled doodad sets.
				if (doodadSetMask && (!doodadSetMask[i] || !doodadSetMask[i].checked))
					continue;

				const set = doodadSets[i];
				const count = set.doodadCount;
				log.write('Exporting WMO doodad set %s with %d doodads...', set.name, count);

				for (let i = 0; i < count; i++) {
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
								const m2Export = new M2Exporter(data);
								await m2Export.exportAsOBJ(m2Path);
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
								DoodadSet: set.name
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
	}

	/**
	 * Export the WMO model as a GLTF file.
	 * @param {string} out 
	 */
	async exportAsGLTF(out) {
		const casc = core.view.casc;
		const confic = core.view.config;

		const outGLTF = ExportHelper.replaceExtension(out, '.gltf');

		// Skip export if file exists and overwriting is disabled.
		//if (!config.overwriteFiles && generics.fileExists(outGLTF))
			//return log.write('Skipping GLTF export of %s (already exists, overwrite disabled)', outGLTF);

			const wmoName = path.basename(out, '.wmo');
			const gltf = new GLTFWriter(outGLTF, wmoName);
	
			const groupMask = this.groupMask;
			const doodadSetMask = this.doodadSetMask;
	
			log.write('Exporting WMO model %s as GLTF: %s', wmoName, outGLTF);
	
			const wmo = this.wmo;
			await wmo.load();
	
			const texMaps = await this.exportTextures(out, null);
			const textureMap = texMaps.texMap;
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
			for (let i = 0, n = wmo.groupCount; i < n; i++) {
				const group = await wmo.getGroup(i);
	
				// Skip empty groups.
				if (!group.renderBatches || group.renderBatches.length === 0)
					continue;
	
				// Skip masked groups.
				if (mask && !mask.has(i))
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
	
				// Normals and vertices should match, so re-use vertOfs here.
				const groupNormals = group.normals;
				for (let i = 0, n = groupNormals.length; i < n; i++)
					normals[vertOfs + i] = groupNormals[i];
	
				const uvsOfs = indOfs * 2;
				if (group.uvs) {
					// UVs exist, use the first array available.
					const groupUvs = group.uvs[0];
					for (let i = 0, n = groupUvs.length; i < n; i++)
						uvs[uvsOfs + i] = groupUvs[i];
				} else {
					// No UVs available for the mesh, zero-fill.
					const uvCount = indCount * 2;
					for (let i = 0; i < uvCount; i++)
						uvs[uvsOfs + i] = 0;
				}
	
				const groupName = wmo.groupNames[group.nameOfs];
	
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
	
			// ToDo: Add support for exporting doodads inside a glTF WMO.
	
			await gltf.write();
	}

	/**
	 * Clear the WMO exporting cache.
	 */
	static clearCache() {
		doodadCache.clear();
	}
}

module.exports = WMOExporter;