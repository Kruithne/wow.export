/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import generics from '../../generics.js';
import OBJWriter from '../writers/OBJWriter.js';
import STLWriter from '../writers/STLWriter.js';
import GeosetMapper from '../GeosetMapper.js';
import core from '../../core.js';
import M2LegacyLoader from '../loaders/M2LegacyLoader.js';
import JSONWriter from '../writers/JSONWriter.js';
import MTLWriter from '../writers/MTLWriter.js';
import BLPImage from '../../casc/blp.js';
import BufferWrapper from '../../buffer.js';
import log from '../../log.js';







class M2LegacyExporter {
	constructor(data, filePath, mpq) {
		this.data = data;
		this.filePath = filePath;
		this.mpq = mpq;
		this.m2 = null;
		this.skinTextures = null;
	}

	setSkinTextures(textures) {
		this.skinTextures = textures;
	}

	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	async exportTextures(outDir, mtl = null, helper) {
		const config = core.view.config;
		const mpq = this.mpq;

		const validTextures = new Map();

		if (!config.modelsExportTextures)
			return validTextures;

		await this.m2.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';

		const exportedTextures = new Set();

		for (let i = 0; i < this.m2.textures.length; i++) {
			if (helper?.isCancelled?.())
				return validTextures;

			const texture = this.m2.textures[i];
			const textureType = this.m2.textureTypes[i];

			let texturePath = texture.fileName;

			// check for variant/skin textures
			if (textureType > 0 && this.skinTextures) {
				if (textureType >= 11 && textureType < 14)
					texturePath = this.skinTextures[textureType - 11];
				else if (textureType > 1 && textureType < 5)
					texturePath = this.skinTextures[textureType - 2];
			}

			if (!texturePath || texturePath.length === 0)
				continue;

			if (exportedTextures.has(texturePath.toLowerCase()))
				continue;

			exportedTextures.add(texturePath.toLowerCase());

			try {
				const textureData = mpq.getFile(texturePath);
				if (!textureData) {
					log.write('Texture not found in MPQ: %s', texturePath);
					continue;
				}

				let texFile = texturePath.split('/').pop();
				texFile = ExportHelper.replaceExtension(texFile, '.png');

				let texPath;
				// legacy mpq exports always use flat textures alongside model for compatibility
				texPath = outDir + '/' + texFile;

				let matName = 'mat_' + texturePath.toLowerCase(.split('/').pop(), '.blp');
				if (config.removePathSpaces)
					matName = matName.replace(/\s/g, '');

				const fileExisted = await generics.fileExists(texPath);

				if (config.overwriteFiles || !fileExisted) {
					const buf = new BufferWrapper(textureData);
					const blp = new BLPImage(buf);
					await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111);

					log.write('Exported legacy M2 texture: %s', texPath);
				} else {
					log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
				}

				if (usePosix)
					texFile = ExportHelper.win32ToPosix(texFile);

				mtl?.addMaterial(matName, texFile);
				validTextures.set(texturePath.toLowerCase(), { matPathRelative: texFile, matPath: texPath, matName });
			} catch (e) {
				log.write('Failed to export texture %s for M2: %s', texturePath, e.message);
			}
		}

		return validTextures;
	}

	async exportAsOBJ(out, helper, fileManifest) {
		const config = core.view.config;

		this.m2 = new M2LegacyLoader(this.data);
		await this.m2.load();

		const skin = await this.m2.getSkin(0);

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = out.substring(0, out.lastIndexOf('/'));
		const modelName = out.split('/').pop().replace('.obj', '');
		obj.setName(modelName);

		log.write('Exporting legacy M2 model %s as OBJ: %s', modelName, out);

		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.addUVArray(this.m2.uv);

		if (config.modelsExportUV2)
			obj.addUVArray(this.m2.uv2);

		helper?.setCurrentTaskName?.(modelName + ' textures');
		const validTextures = await this.exportTextures(outDir, mtl, helper);

		for (const [texPath, texInfo] of validTextures)
			fileManifest?.push({ type: 'PNG', file: texInfo.matPath });

		if (helper?.isCancelled?.())
			return;

		// export mesh data
		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			if (this.geosetMask && !this.geosetMask[mI]?.checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);

			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			let matName;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit) {
				const texIndex = this.m2.textureCombos[texUnit.textureComboIndex];
				const texture = this.m2.textures[texIndex];
				const textureType = this.m2.textureTypes[texIndex];

				// resolve texture path same as exportTextures
				let texturePath = texture?.fileName;
				if (textureType > 0 && this.skinTextures) {
					if (textureType >= 11 && textureType < 14)
						texturePath = this.skinTextures[textureType - 11];
					else if (textureType > 1 && textureType < 5)
						texturePath = this.skinTextures[textureType - 2];
				}

				if (texturePath && validTextures.has(texturePath.toLowerCase()))
					matName = validTextures.get(texturePath.toLowerCase()).matName;
			}

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(mtl.out.split('/').pop());

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', file: mtl.out });

		if (config.exportM2Meta) {
			helper?.clearCurrentTask?.();
			helper?.setCurrentTaskName?.(modelName + ', writing meta data');

			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));

			// clone submesh array with enabled property
			const subMeshes = Array(skin.subMeshes.length);
			for (let i = 0, n = subMeshes.length; i < n; i++) {
				const subMeshEnabled = !this.geosetMask || this.geosetMask[i]?.checked;
				subMeshes[i] = Object.assign({ enabled: subMeshEnabled }, skin.subMeshes[i]);
			}

			// clone textures array with expanded info
			const textures = new Array(this.m2.textures.length);
			for (let i = 0, n = textures.length; i < n; i++) {
				const texture = this.m2.textures[i];
				const textureType = this.m2.textureTypes[i];

				// resolve texture path same as exportTextures
				let texturePath = texture.fileName;
				if (textureType > 0 && this.skinTextures) {
					if (textureType >= 11 && textureType < 14)
						texturePath = this.skinTextures[textureType - 11];
					else if (textureType > 1 && textureType < 5)
						texturePath = this.skinTextures[textureType - 2];
				}

				const textureEntry = validTextures.get(texturePath?.toLowerCase());

				textures[i] = {
					fileName: texturePath,
					fileNameExternal: textureEntry?.matPathRelative,
					mtlName: textureEntry?.matName,
					type: textureType
				};
			}

			json.addProperty('fileType', 'm2');
			json.addProperty('filePath', this.filePath);
			json.addProperty('internalName', this.m2.name);
			json.addProperty('version', this.m2.version);
			json.addProperty('flags', this.m2.flags);
			json.addProperty('textures', textures);
			json.addProperty('textureTypes', this.m2.textureTypes);
			json.addProperty('materials', this.m2.materials);
			json.addProperty('textureCombos', this.m2.textureCombos);
			json.addProperty('transparencyLookup', this.m2.transparencyLookup);
			json.addProperty('textureTransformsLookup', this.m2.textureTransformsLookup);
			json.addProperty('boundingBox', this.m2.boundingBox);
			json.addProperty('boundingSphereRadius', this.m2.boundingSphereRadius);
			json.addProperty('collisionBox', this.m2.collisionBox);
			json.addProperty('collisionSphereRadius', this.m2.collisionSphereRadius);
			json.addProperty('skin', {
				subMeshes: subMeshes,
				textureUnits: skin.textureUnits
			});

			await json.write(config.overwriteFiles);
			fileManifest?.push({ type: 'META', file: json.out });
		}
	}

	async exportAsSTL(out, helper, fileManifest) {
		const config = core.view.config;

		this.m2 = new M2LegacyLoader(this.data);
		await this.m2.load();

		const skin = await this.m2.getSkin(0);

		const stl = new STLWriter(out);
		const modelName = out.split('/').pop().replace('.stl', '');
		stl.setName(modelName);

		log.write('Exporting legacy M2 model %s as STL: %s', modelName, out);

		stl.setVertArray(this.m2.vertices);
		stl.setNormalArray(this.m2.normals);

		if (helper?.isCancelled?.())
			return;

		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			if (this.geosetMask && !this.geosetMask[mI]?.checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);

			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			stl.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts);
		}

		await stl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'STL', file: stl.out });
	}

	async exportRaw(out, helper, fileManifest) {
		const config = core.view.config;
		const mpq = this.mpq;
		const outDir = out.substring(0, out.lastIndexOf('/'));

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('filePath', this.filePath);

		// write main m2 file
		await this.data.writeToFile(out);
		fileManifest?.push({ type: 'M2', file: out });

		log.write('Exported legacy M2: %s', out);

		// export textures if enabled
		if (config.modelsExportTextures) {
			this.m2 = new M2LegacyLoader(this.data);
			await this.m2.load();

			const texturesManifest = [];
			const exportedTextures = new Set();

			// export embedded textures (type 0 with fileName)
			for (const texture of this.m2.textures) {
				if (!texture.fileName)
					continue;

				const texturePath = texture.fileName;

				// skip duplicates
				if (exportedTextures.has(texturePath.toLowerCase()))
					continue;

				exportedTextures.add(texturePath.toLowerCase());

				try {
					const textureData = mpq.getFile(texturePath);
					if (!textureData) {
						log.write('Texture not found in MPQ: %s', texturePath);
						continue;
					}

					let texOut;
					if (config.enableSharedTextures)
						texOut = ExportHelper.getExportPath(texturePath);
					else
						texOut = outDir + '/' + texturePath.split('/'.pop());

					const buf = new BufferWrapper(textureData);
					await buf.writeToFile(texOut);

					texturesManifest.push({ file: texOut.replace(outDir, ''), path: texturePath, type: 'embedded' });
					fileManifest?.push({ type: 'BLP', file: texOut });

					log.write('Exported legacy M2 texture: %s', texOut);
				} catch (e) {
					log.write('Failed to export texture %s: %s', texturePath, e.message);
				}
			}

			// export skin/variant textures (creature skins, etc)
			if (this.skinTextures && this.skinTextures.length > 0) {
				for (const texturePath of this.skinTextures) {
					if (!texturePath)
						continue;

					// skip duplicates
					if (exportedTextures.has(texturePath.toLowerCase()))
						continue;

					exportedTextures.add(texturePath.toLowerCase());

					try {
						const textureData = mpq.getFile(texturePath);
						if (!textureData) {
							log.write('Skin texture not found in MPQ: %s', texturePath);
							continue;
						}

						let texOut;
						if (config.enableSharedTextures)
							texOut = ExportHelper.getExportPath(texturePath);
						else
							texOut = outDir + '/' + texturePath.split('/'.pop());

						const buf = new BufferWrapper(textureData);
						await buf.writeToFile(texOut);

						texturesManifest.push({ file: texOut.replace(outDir, ''), path: texturePath, type: 'skin' });
						fileManifest?.push({ type: 'BLP', file: texOut });

						log.write('Exported legacy M2 skin texture: %s', texOut);
					} catch (e) {
						log.write('Failed to export skin texture %s: %s', texturePath, e.message);
					}
				}
			}

			manifest.addProperty('textures', texturesManifest);
		}

		await manifest.write();
		fileManifest?.push({ type: 'MANIFEST', file: manifestFile });
	}
}

export default M2LegacyExporter;