/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
import { exporter, listfile } from '../../../views/main/rpc.js';
import generics from '../../generics.js';
import ExportHelper from '../../export-helper.js';
import SKELLoader from '../loaders/SKELLoader.js';
import JSONWriter from '../writers/JSONWriter.js';
import MTLWriter from '../writers/MTLWriter.js';
import core from '../../core.js';
import M3Loader from '../loaders/M3Loader.js';
import OBJWriter from '../writers/OBJWriter.js';
import STLWriter from '../writers/STLWriter.js';
import GLTFWriter from '../writers/GLTFWriter.js';
import log from '../../log.js';
import BufferWrapper from '../../buffer.js';
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
	 * @param {exporter} helper
	 * @param {boolean} [fullTexPaths=false]
	 * @returns {Map<number, string>}
	 */
	async exportTextures(out, raw = false, mtl = null, helper, fullTexPaths = false) {
		const validTextures = new Map();
		return validTextures;
	}

	async exportAsGLTF(out, helper, format = 'gltf') {
		const ext = format === 'glb' ? '.glb' : '.gltf';
		const outGLTF = ExportHelper.replaceExtension(out, ext);
		const outDir = out.substring(0, out.lastIndexOf('/'));

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && await generics.fileExists(outGLTF))
			return log.write('Skipping %s export of %s (already exists, overwrite disabled)', format.toUpperCase(), outGLTF);

		await this.m3.load();

		const model_name = outGLTF.split('/').pop().replace(ext, '');
		const gltf = new GLTFWriter(out, model_name);
		log.write('Exporting M3 model %s as %s: %s', model_name, format.toUpperCase(), outGLTF);

		gltf.setVerticesArray(this.m3.vertices);
		gltf.setNormalArray(this.m3.normals);
		// gltf.setBoneWeightArray(this.m3.boneWeights);
		// gltf.setBoneIndexArray(this.m3.boneIndices)

		gltf.addUVArray(this.m3.uv);
		if (core.view.config.modelsExportUV2 && this.m3.uv1 !== undefined)
			gltf.addUVArray(this.m3.uv1);

		const textureMap = await this.exportTextures(outDir, false, null, helper, true);
		gltf.setTextureMap(textureMap);

		const index = 0;
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

		await gltf.write(core.view.config.overwriteFiles, format);
	}

	/**
	 * Export the M3 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {exporter} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, exportCollision = false, helper, fileManifest) {
		await this.m3.load();

		const config = core.view.config;
		//const exportMeta = core.view.config.exportM2Meta;
		//const exportBones = core.view.config.exportM2Bones;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = out.substring(0, out.lastIndexOf('/'));

		// Use internal M3 name or fallback to the OBJ file name.
		const model_name = out.split('/').pop().replace('.obj', '');
		obj.setName(model_name);

		log.write('Exporting M3 model %s as OBJ: %s', model_name, out);

		// Verts, normals, UVs
		obj.setVertArray(this.m3.vertices);
		obj.setNormalArray(this.m3.normals);
		obj.addUVArray(this.m3.uv);

		if (core.view.config.modelsExportUV2 && this.m3.uv1 !== undefined)
			obj.addUVArray(this.m3.uv1);

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

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(mtl.out.split('/').pop());

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
	 * Export the M3 model as an STL file.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {exporter} helper
	 * @param {Array} fileManifest
	 */
	async exportAsSTL(out, exportCollision = false, helper, fileManifest) {
		await this.m3.load();

		const config = core.view.config;

		const stl = new STLWriter(out);
		const model_name = out.split('/').pop().replace('.stl', '');
		stl.setName(model_name);

		log.write('Exporting M3 model %s as STL: %s', model_name, out);

		// verts, normals
		stl.setVertArray(this.m3.vertices);
		stl.setNormalArray(this.m3.normals);

		// abort if the export has been cancelled
		if (helper.isCancelled())
			return;

		const index = 0;
		for (let lodIndex = 0; lodIndex < this.m3.lodLevels.length; lodIndex++) {
			if (lodIndex != index)
				continue;

			for (let geosetIndex = this.m3.geosetCountPerLOD * lodIndex; geosetIndex < (this.m3.geosetCountPerLOD * (lodIndex + 1)); geosetIndex++) {
				const geoset = this.m3.geosets[geosetIndex];
				const geosetName = this.m3.stringBlock.slice(geoset.nameCharStart, geoset.nameCharStart + geoset.nameCharCount);
				log.write('Exporting geoset ' + geosetIndex + ' (' + geosetName + ')');

				stl.addMesh(geosetName, this.m3.indices.slice(geoset.indexStart, geoset.indexStart + geoset.indexCount));
			}
		}

		await stl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'STL', fileDataID: this.fileDataID, file: stl.out });
	}

	/**
	 * Export the model as a raw M3 file, including related files
	 * such as textures, bones, animations, etc.
	 * @param {string} out 
	 * @param {exporter} helper 
	 * @param {Array} [fileManifest]
	 */
	async exportRaw(out, helper, fileManifest) {
		const config = core.view.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.fileDataID);

		// Write the M3 file with no conversion.
		await this.m3.data.writeToFile(out);
		fileManifest?.push({ type: 'M3', fileDataID: this.fileDataID, file: out });

		// Only load M2 data if we need to export related files.
		if (config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone || config.modelsExportAnim)
			await this.m3.load();

		await manifest.write();
	}
}

export default M3Exporter;