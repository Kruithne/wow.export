/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');
const path = require('path');
const generics = require('../../generics');
const listfile = require('../../casc/listfile');

const BLPFile = require('../../casc/blp');
const M3Loader= require('../loaders/M3Loader');
const SKELLoader = require('../loaders/SKELLoader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const JSONWriter = require('../writers/JSONWriter');
const GLTFWriter = require('../writers/GLTFWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');
const BufferWrapper = require('../../buffer');

class M3Exporter {
	/**
	 * Construct a new M3Exporter instance.
	 * @param {BufferWrapper}
	 * @param {Array} variantTextures
	 * @param {number} fileDataID
	 */
	constructor(data, variantTextures, fileDataID) {
		this.m3 = new M3Loader(data);
		this.fileDataID = fileDataID;
		this.variantTextures = variantTextures;
		this.dataTextures = new Map();
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param {Array} mask 
	 */
	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	/**
	 * Export additional texture from canvas
	 */
	async addURITexture(out, dataURI) {
		this.dataTextures.set(out, dataURI);
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
		const validTextures = new Map();
		return validTextures;
	}

	async exportAsGLTF(out, helper) {
		const outGLTF = ExportHelper.replaceExtension(out, '.gltf');
		const outDir = path.dirname(out);

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && await generics.fileExists(outGLTF))
			return log.write('Skipping GLTF export of %s (already exists, overwrite disabled)', outGLTF);

		await this.m3.load();

		const model_name = path.basename(outGLTF, '.gltf');
		const gltf = new GLTFWriter(out, model_name);
		log.write('Exporting M3 model %s as GLTF: %s', model_name, outGLTF);

		gltf.setVerticesArray(this.m3.vertices);
		gltf.setNormalArray(this.m3.normals);
		// gltf.setBoneWeightArray(this.m3.boneWeights);
		// gltf.setBoneIndexArray(this.m3.boneIndices)

		gltf.addUVArray(this.m3.uv);
		gltf.addUVArray(this.m3.uv2);

		const textureMap = await this.exportTextures(outDir, false, null, helper, true);
		gltf.setTextureMap(textureMap);

		for (let lodIndex = 0; lodIndex < this.m3.lodLevels.length; lodIndex++) {
			if (lodIndex != index)
				continue;

			for (let geosetIndex = this.m3.geosetCountPerLOD * lodIndex; geosetIndex < (this.m3.geosetCountPerLOD * (lodIndex + 1)); geosetIndex++) {
				const geoset = this.m3.geosets[geosetIndex];
				const geosetName = this.m3.stringBlock.slice(geoset.nameCharStart, geoset.nameCharStart + geoset.nameCharCount);
				log.write("Exporting geoset " + geosetIndex + " (" + geosetName + ")");

				gltf.addMesh(geosetName, this.m3.indices.slice(geoset.indexStart, geoset.indexStart + geoset.indexCount), "");
			}
		}

		// TODO: M3
		// for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
		// 	// Skip geosets that are not enabled.
		// 	if (this.geosetMask && !this.geosetMask[mI]?.checked)
		// 		continue;

		// 	const mesh = skin.subMeshes[mI];
		// 	const indices = new Array(mesh.triangleCount);
		// 	for (let vI = 0; vI < mesh.triangleCount; vI++)
		// 		indices[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

		// 	let texture = null;
		// 	const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
		// 	if (texUnit)
		// 		texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

		// 	let matName;
		// 	if (texture?.fileDataID > 0 && textureMap.has(texture.fileDataID))
		// 		matName = texture.fileDataID;

		// 	if (this.dataTextures.has(this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]])) {
		// 		matName = 'data-' + this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]];
		// 		console.log("Setting meshIndex " + mI + " to " + matName);
		// 	}

		// 	gltf.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), indices, matName);
		// }

		await gltf.write(core.view.config.overwriteFiles);
	}

	/**
	 * Export the M3 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, exportCollision = false, helper, fileManifest) {
		await this.m3.load();

		const config = core.view.config;
		//const exportMeta = core.view.config.exportM2Meta;
		//const exportBones = core.view.config.exportM2Bones;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = path.dirname(out);

		// Use internal M3 name or fallback to the OBJ file name.
		const model_name = path.basename(out, '.obj');
		obj.setName(model_name);

		log.write('Exporting M3 model %s as OBJ: %s', model_name, out);

		// Verts, normals, UVs
		obj.setVertArray(this.m3.vertices);
		obj.setNormalArray(this.m3.normals);
		obj.addUVArray(this.m3.uv);

		if (core.view.config.modelsExportUV2)
			obj.addUVArray(this.m3.uv2);

		// Textures
		const validTextures = await this.exportTextures(outDir, false, mtl, helper);
		for (const [texFileDataID, texInfo] of validTextures)
			fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texInfo.matPath });

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		const index = 0;
		for (let lodIndex = 0; lodIndex < this.m3.lodLevels.length; lodIndex++) {
			if (lodIndex != index)
				continue;

			for (let geosetIndex = this.m3.geosetCountPerLOD * lodIndex; geosetIndex < (this.m3.geosetCountPerLOD * (lodIndex + 1)); geosetIndex++) {
				const geoset = this.m3.geosets[geosetIndex];
				const geosetName = this.m3.stringBlock.slice(geoset.nameCharStart, geoset.nameCharStart + geoset.nameCharCount);
				log.write("Exporting geoset " + geosetIndex + " (" + geosetName + ")");

				obj.addMesh(geosetName, this.m3.indices.slice(geoset.indexStart, geoset.indexStart + geoset.indexCount), "");
			}
		}

		// Faces
		// TODO: M3
		// for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
		// 	// Skip geosets that are not enabled.
		// 	if (this.geosetMask && !this.geosetMask[mI].checked)
		// 		continue;

		// 	const mesh = skin.subMeshes[mI];
		// 	const verts = new Array(mesh.triangleCount);
		// 	for (let vI = 0; vI < mesh.triangleCount; vI++)
		// 		verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

		// 	let texture = null;
		// 	const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
		// 	if (texUnit)
		// 		texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

		// 	let matName;
		// 	if (texture?.fileDataID > 0 && validTextures.has(texture.fileDataID))
		// 		matName = validTextures.get(texture.fileDataID).matName;

		// 	obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		// }

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', fileDataID: this.fileDataID, file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', fileDataID: this.fileDataID, file: mtl.out });

		if (exportCollision) {
			// const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			// phys.setVertArray(this.m2.collisionPositions);
			// phys.setNormalArray(this.m2.collisionNormals);
			// phys.addMesh('Collision', this.m2.collisionIndices);

			// await phys.write(config.overwriteFiles);
			// fileManifest?.push({ type: 'PHYS_OBJ', fileDataID: this.fileDataID, file: phys.out });
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
		const config = core.view.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.fileDataID);

		// Write the M2 file with no conversion.
		await this.m3.data.writeToFile(out);
		fileManifest?.push({ type: 'M3', fileDataID: this.fileDataID, file: out });

		// Only load M2 data if we need to export related files.
		if (config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone || config.modelsExportAnim)
			await this.m3.load();

		await manifest.write();
	}
}

module.exports = M3Exporter;