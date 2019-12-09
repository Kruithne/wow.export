const core = require('../../core');
const log = require('../../log');
const listfile = require('../../casc/listfile');

const BLPFile = require('../../casc/blp');
const WMOLoader = require('../loaders/WMOLoader');
const M2Loader = require('../loaders/M2Loader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');

class WMOExporter {
	/**
	 * Construct a new WMOExporter instance.
	 * @param {BufferWrapper} data
	 * @param {string|number} fileID
	 */
	constructor(data, fileID) {
		//this.m2 = new M2Loader(data);
		this.wmo = new WMOLoader(data, fileID);
	}

	/**
	 * Export the WMO model as a WaveFront OBJ.
	 * @param {string} out
	 */
	async exportAsOBJ(out) {
		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const wmoName = path.basename(out, '.wmo');
		obj.setName(wmoName);

		log.write('Exporting WMO model %s as OBJ: %s', wmoName, out);

		const wmo = this.wmo;
		await wmo.load();

		// Textures
		const isClassic = !!wmo.textureNames;
		const materialCount = wmo.materials.length;
		const materialMap = new Map();
		for (let i = 0; i < materialCount; i++) {
			const material = wmo.materials[i];

			let fileDataID;
			if (isClassic) {
				// Classic, look-up fileDataID using file name.
				fileDataID = listfile.getByFilename(wmo.textureNames[material.texture1]) || 0;
			} else {
				// Retail, use fileDataID directly.
				fileDataID = material.texture1;
			}

			if (fileDataID > 0) {
				try {
					const data = await core.view.casc.getFile(fileDataID);
					const blp = new BLPFile(data);

					const texFile = fileDataID + '.png';
					const texPath = path.join(path.dirname(out), texFile);

					log.write('Exporting WMO texture %d -> %s', fileDataID, texPath);
					await blp.saveToFile(texPath, 'image/png', true);

					mtl.addMaterial(fileDataID, texFile);
					materialMap.set(i, fileDataID);
				} catch (e) {
					log.write('Failed to export texture %d for WMO: %s', fileDataID, e.message);
				}
			}
		}

		const groups = [];
		let nInd = 0;

		// Iterate over the groups once to calculate the total size of our
		// vertex/normal/uv arrays allowing for pre-allocation.
		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			const group = await wmo.getGroup(i);

			// Skip empty groups.
			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			// 3 verts per indicies.
			nInd += group.verticies.length / 3;

			// Store the valid groups for quicker iteration later.
			groups.push(group);
		}

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);
		const uvsArray = new Array(nInd * 2);

		// Iterate over groups again and fill the allocated arrays.
		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.verticies.length / 3;

			const vertOfs = indOfs * 3;
			const groupVerts = group.verticies;
			for (let i = 0, n = groupVerts.length; i < n; i++)
				vertsArray[vertOfs + i] = groupVerts[i];

			// Normals and verticies should match, so re-use vertOfs here.
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
				const indicies = new Array(batch.numFaces);

				for (let i = 0; i < batch.numFaces; i++)
					indicies[i] = group.indicies[batch.firstFace + i] + indOfs;

				const matID = batch.flags === 2 ? batch.possibleBox2[2] : batch.materialID;
				obj.addMesh(groupName + bI, indicies, materialMap.get(matID));
			}

			indOfs += indCount;
		}

		obj.setVertArray(vertsArray);
		obj.setNormalArray(normalsArray);
		obj.setUVArray(uvsArray);

		await obj.write();
		await mtl.write();
	}
}

module.exports = WMOExporter;