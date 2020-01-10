/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');
const path = require('path');
const generics = require('../../generics');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');

class M2Exporter {
	/**
	 * Construct a new M2Exporter instance.
	 * @param {BufferWrapper}
	 * @param {number} variantTexture
	 */
	constructor(data, variantTexture = 0) {
		this.m2 = new M2Loader(data);
		this.variantTexture = variantTexture;
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param {Array} mask 
	 */
	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 */
	async exportAsOBJ(out, exportCollision = false) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = core.view.config;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		log.write('Exporting M2 model %s as OBJ: %s', this.m2.name, out);

		// Use internal M2 name for object.
		obj.setName(this.m2.name);

		// Verts, normals, UVs
		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.setUVArray(this.m2.uv);

		// Textures
		const validTextures = {};
		for (const texture of this.m2.textures) {
			let texFileDataID = texture.fileDataID;

			// Blank texture, do we have a variant texture?
			if (texFileDataID === 0) {
				texFileDataID = this.variantTexture;

				// Backward patch the variant texture into the M2 instance so that
				// the MTL exports with the correct texture once we swap it here.
				texture.fileDataID = this.variantTexture;
			}

			if (texFileDataID > 0) {
				try {
					let texFile = texFileDataID + '.png';
					let texPath = path.join(path.dirname(out), texFile);

					// Map texture files relative to shared directory.
					if (config.enableSharedTextures) {
						texPath = ExportHelper.getSharedTexturePath(texFile);
						texFile = path.relative(path.dirname(out), texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						const blp = new BLPFile(data);

						log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);
						await blp.saveToFile(texPath, 'image/png', true);
					} else {
						log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
					}

					mtl.addMaterial(texFileDataID, texFile);
					validTextures[texFileDataID] = true;
				} catch (e) {
					log.write('Failed to export texture %d for M2: %s', texFileDataID, e.message);
				}
			}
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
			if (texture && texture.fileDataID > 0 && validTextures[texture.fileDataID])
				matName = texture.fileDataID;

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);

		if (exportCollision) {
			const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices);

			await phys.write(config.overwriteFiles);
		}
	}
}

module.exports = M2Exporter;