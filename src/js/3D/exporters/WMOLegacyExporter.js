/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import generics from '../../generics.js';
import ExportHelper from '../../export-helper.js';
import JSONWriter from '../writers/JSONWriter.js';
import MTLWriter from '../writers/MTLWriter.js';
import BLPImage from '../../casc/blp.js';
import core from '../../core.js';
import WMOLegacyLoader from '../loaders/WMOLegacyLoader.js';
import OBJWriter from '../writers/OBJWriter.js';
import STLWriter from '../writers/STLWriter.js';
import BufferWrapper from '../../buffer.js';
import log from '../../log.js';








const doodadCache = new Set();

class WMOLegacyExporter {
	constructor(data, filePath, mpq) {
		this.data = data;
		this.filePath = filePath;
		this.mpq = mpq;
		this.wmo = null;

		// extract mpq prefix from filepath (e.g. "wmo.MPQ" from "wmo.MPQ\world\...")
		const normalizedPath = filePath.replace(/\//g, '\\');
		const firstSep = normalizedPath.indexOf('\\');
		this.mpqPrefix = firstSep > 0 && normalizedPath.substring(0, firstSep).toLowerCase().endsWith('.mpq')
			? normalizedPath.substring(0, firstSep)
			: '';
	}

	setGroupMask(mask) {
		this.groupMask = mask;
	}

	setDoodadSetMask(mask) {
		this.doodadSetMask = mask;
	}

	async exportTextures(out, mtl = null, helper) {
		const config = core.view.config;
		const mpq = this.mpq;
		const outDir = out.substring(0, out.lastIndexOf('/'));

		const textureMap = new Map();
		const materialMap = new Map();

		if (!config.modelsExportTextures)
			return { textureMap, materialMap };

		await this.wmo.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';
		const materialCount = this.wmo.materials?.length ?? 0;

		helper?.setCurrentTaskMax?.(materialCount);

		for (let i = 0; i < materialCount; i++) {
			if (helper?.isCancelled?.())
				return { textureMap, materialMap };

			const material = this.wmo.materials[i];
			helper?.setCurrentTaskValue?.(i);

			const materialTextures = [material.texture1, material.texture2, material.texture3];

			for (const materialTexture of materialTextures) {
				if (materialTexture === 0)
					continue;

				const texturePath = this.wmo.textureNames?.[materialTexture];
				if (!texturePath || texturePath.length === 0)
					continue;

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

						log.write('Exported legacy WMO texture: %s', texPath);
					} else {
						log.write('Skipping WMO texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					mtl?.addMaterial(matName, texFile);
					textureMap.set(materialTexture, { matPathRelative: texFile, matPath: texPath, matName });

					if (!materialMap.has(i))
						materialMap.set(i, matName);
				} catch (e) {
					log.write('Failed to export texture %s for WMO: %s', texturePath, e.message);
				}
			}
		}

		return { textureMap, materialMap };
	}

	async exportAsOBJ(out, helper, fileManifest) {
		const config = core.view.config;
		const mpq = this.mpq;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const groupMask = this.groupMask;
		const doodadSetMask = this.doodadSetMask;

		const wmoName = out.split('/').pop().replace('.obj', '');
		obj.setName(wmoName);

		log.write('Exporting legacy WMO model %s as OBJ: %s', wmoName, out);

		this.wmo = new WMOLegacyLoader(this.data, this.filePath, false);
		await this.wmo.load();

		const wmo = this.wmo;
		const outDir = out.substring(0, out.lastIndexOf('/'));

		helper?.setCurrentTaskName?.(wmoName + ' textures');

		const texMaps = await this.exportTextures(out, mtl, helper);

		if (helper?.isCancelled?.())
			return;

		const materialMap = texMaps.materialMap;
		const textureMap = texMaps.textureMap;

		for (const [texOffset, texInfo] of textureMap)
			fileManifest?.push({ type: 'PNG', file: texInfo.matPath });

		const groups = [];
		let nInd = 0;
		let maxLayerCount = 0;

		let mask;
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked)
					mask.add(group.groupIndex);
			}
		}

		helper?.setCurrentTaskName?.(wmoName + ' groups');
		helper?.setCurrentTaskMax?.(wmo.groupCount);

		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			if (helper?.isCancelled?.())
				return;

			helper?.setCurrentTaskValue?.(i);

			const group = await wmo.getGroup(i);

			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			if (mask && !mask.has(i))
				continue;

			nInd += group.vertices.length / 3;
			maxLayerCount = Math.max(group.uvs?.length ?? 0, maxLayerCount);

			groups.push(group);
		}

		if (!config.modelsExportUV2)
			maxLayerCount = Math.min(maxLayerCount, 1);

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);
		const uvArrays = new Array(maxLayerCount);

		for (let i = 0; i < maxLayerCount; i++)
			uvArrays[i] = new Array(nInd * 2);

		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.vertices.length / 3;

			const vertOfs = indOfs * 3;
			const groupVerts = group.vertices;
			for (let i = 0, n = groupVerts.length; i < n; i++)
				vertsArray[vertOfs + i] = groupVerts[i];

			const groupNormals = group.normals;
			for (let i = 0, n = groupNormals.length; i < n; i++)
				normalsArray[vertOfs + i] = groupNormals[i];

			const uvsOfs = indOfs * 2;
			const groupUVs = group.uvs ?? [];
			const uvCount = indCount * 2;

			for (let i = 0; i < maxLayerCount; i++) {
				const uv = groupUVs[i];
				for (let j = 0; j < uvCount; j++)
					uvArrays[i][uvsOfs + j] = uv?.[j] ?? 0;
			}

			const groupName = wmo.groupNames?.[group.nameOfs] ?? ('group_' + groups.indexOf(group));

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

		// doodad placement csv
		const csvPath = ExportHelper.replaceExtension(out, '_ModelPlacementInformation.csv');
		if (config.overwriteFiles || !await generics.fileExists(csvPath)) {
			const useAbsolute = config.enableAbsoluteCSVPaths;
			const usePosix = config.pathFormat === 'posix';
			const csv = new CSVWriter(csvPath);
			csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationW', 'RotationX', 'RotationY', 'RotationZ', 'ScaleFactor', 'DoodadSet');

			const doodadSets = wmo.doodadSets ?? [];
			for (let i = 0, n = doodadSets.length; i < n; i++) {
				if (!doodadSetMask?.[i]?.checked)
					continue;

				const set = doodadSets[i];
				const count = set.doodadCount;
				log.write('Exporting legacy WMO doodad set %s with %d doodads...', set.name, count);

				helper?.setCurrentTaskName?.(wmoName + ', doodad set ' + set.name);
				helper?.setCurrentTaskMax?.(count);

				for (let j = 0; j < count; j++) {
					if (helper?.isCancelled?.())
						return;

					helper?.setCurrentTaskValue?.(j);

					const doodad = wmo.doodads?.[set.firstInstanceIndex + j];
					if (!doodad)
						continue;

					const fileName = wmo.doodadNames?.[doodad.offset];
					if (!fileName)
						continue;

					try {
						let objFileName = ExportHelper.replaceExtension(fileName, '.obj');

						// prepend mpq prefix for consistent export paths
						const prefixedObjFileName = this.mpqPrefix ? this.mpqPrefix + '/' + objFileName : objFileName;
						const prefixedFileName = this.mpqPrefix ? this.mpqPrefix + '/' + fileName : fileName;

						let m2Path;
						if (config.enableSharedChildren)
							m2Path = ExportHelper.getExportPath(prefixedObjFileName);
						else
							m2Path = ExportHelper.replaceFile(out, objFileName);

						if (!doodadCache.has(fileName.toLowerCase())) {
							const m2Data = mpq.getFile(fileName);
							if (m2Data) {
								const buf = new BufferWrapper(m2Data);
								const m2Export = new M2LegacyExporter(buf, prefixedFileName, mpq);
								await m2Export.exportAsOBJ(m2Path, helper);

								if (helper?.isCancelled?.())
									return;

								doodadCache.add(fileName.toLowerCase());
							}
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
							DoodadSet: set.name
						});
					} catch (e) {
						log.write('Failed to export doodad %s for %s: %s', fileName, set.name, e.message);
					}
				}
			}

			await csv.write();
			fileManifest?.push({ type: 'PLACEMENT', file: csv.out });
		} else {
			log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(mtl.out.split('/').pop());

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', file: mtl.out });

		if (config.exportWMOMeta) {
			helper?.clearCurrentTask?.();
			helper?.setCurrentTaskName?.(wmoName + ', writing meta data');

			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));
			json.addProperty('fileType', 'wmo');
			json.addProperty('filePath', this.filePath);
			json.addProperty('version', wmo.version);
			json.addProperty('counts', {
				material: wmo.materialCount,
				group: wmo.groupCount,
				portal: wmo.portalCount,
				light: wmo.lightCount,
				model: wmo.modelCount,
				doodad: wmo.doodadCount,
				set: wmo.setCount
			});

			json.addProperty('ambientColor', wmo.ambientColor);
			json.addProperty('wmoID', wmo.wmoID);
			json.addProperty('boundingBox1', wmo.boundingBox1);
			json.addProperty('boundingBox2', wmo.boundingBox2);
			json.addProperty('flags', wmo.flags);
			json.addProperty('groupNames', wmo.groupNames ? Object.values(wmo.groupNames) : []);
			json.addProperty('groupInfo', wmo.groupInfo);
			json.addProperty('materials', wmo.materials);
			json.addProperty('doodadSets', wmo.doodadSets);
			json.addProperty('doodads', wmo.doodads);

			await json.write(config.overwriteFiles);
			fileManifest?.push({ type: 'META', file: json.out });
		}
	}

	async exportAsSTL(out, helper, fileManifest) {
		const config = core.view.config;
		const stl = new STLWriter(out);

		const groupMask = this.groupMask;

		const wmoName = out.split('/').pop().replace('.stl', '');
		stl.setName(wmoName);

		log.write('Exporting legacy WMO model %s as STL: %s', wmoName, out);

		this.wmo = new WMOLegacyLoader(this.data, this.filePath, false);
		await this.wmo.load();

		const wmo = this.wmo;
		const groups = [];
		let nInd = 0;

		let mask;
		if (groupMask) {
			mask = new Set();
			for (const group of groupMask) {
				if (group.checked)
					mask.add(group.groupIndex);
			}
		}

		helper?.setCurrentTaskName?.(wmoName + ' groups');
		helper?.setCurrentTaskMax?.(wmo.groupCount);

		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			if (helper?.isCancelled?.())
				return;

			helper?.setCurrentTaskValue?.(i);

			const group = await wmo.getGroup(i);

			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			if (mask && !mask.has(i))
				continue;

			nInd += group.vertices.length / 3;
			groups.push(group);
		}

		const vertsArray = new Array(nInd * 3);
		const normalsArray = new Array(nInd * 3);

		let indOfs = 0;
		for (const group of groups) {
			const indCount = group.vertices.length / 3;

			const vertOfs = indOfs * 3;
			const groupVerts = group.vertices;
			for (let i = 0, n = groupVerts.length; i < n; i++)
				vertsArray[vertOfs + i] = groupVerts[i];

			const groupNormals = group.normals;
			for (let i = 0, n = groupNormals.length; i < n; i++)
				normalsArray[vertOfs + i] = groupNormals[i];

			const groupName = wmo.groupNames?.[group.nameOfs] ?? ('group_' + groups.indexOf(group));

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
		fileManifest?.push({ type: 'STL', file: stl.out });
	}

	async exportRaw(out, helper, fileManifest) {
		const config = core.view.config;
		const mpq = this.mpq;
		const outDir = out.substring(0, out.lastIndexOf('/'));

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('filePath', this.filePath);

		// write main wmo root file
		await this.data.writeToFile(out);
		fileManifest?.push({ type: 'WMO', file: out });

		log.write('Exported legacy WMO root: %s', out);

		// load wmo for parsing related files
		this.wmo = new WMOLegacyLoader(this.data, this.filePath, true);
		await this.wmo.load();

		// export textures
		if (config.modelsExportTextures) {
			const texturesManifest = [];
			const exportedTextures = new Set();

			const textureNames = this.wmo.textureNames || {};

			for (const texturePath of Object.values(textureNames)) {
				if (!texturePath || texturePath.length === 0)
					continue;

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

					texturesManifest.push({ file: texOut.replace(outDir, ''), path: texturePath });
					fileManifest?.push({ type: 'BLP', file: texOut });

					log.write('Exported legacy WMO texture: %s', texOut);
				} catch (e) {
					log.write('Failed to export WMO texture %s: %s', texturePath, e.message);
				}
			}

			manifest.addProperty('textures', texturesManifest);
		}

		// export wmo group files
		if (config.modelsExportWMOGroups && this.wmo.groupCount > 0) {
			const groupsManifest = [];

			for (let i = 0; i < this.wmo.groupCount; i++) {
				if (helper?.isCancelled?.())
					return;

				const groupFileName = this.filePath.replace('.wmo', '_' + i.toString().padStart(3, '0') + '.wmo');

				try {
					const groupData = mpq.getFile(groupFileName);
					if (!groupData) {
						log.write('WMO group file not found: %s', groupFileName);
						continue;
					}

					let groupOut;
					if (config.enableSharedChildren)
						groupOut = ExportHelper.getExportPath(groupFileName);
					else
						groupOut = outDir + '/' + groupFileName.split('/'.pop());

					const buf = new BufferWrapper(groupData);
					await buf.writeToFile(groupOut);

					groupsManifest.push({ file: groupOut.replace(outDir, ''), path: groupFileName, index: i });
					fileManifest?.push({ type: 'WMO_GROUP', file: groupOut });

					log.write('Exported legacy WMO group: %s', groupOut);
				} catch (e) {
					log.write('Failed to export WMO group %s: %s', groupFileName, e.message);
				}
			}

			manifest.addProperty('groups', groupsManifest);
		}

		await manifest.write();
		fileManifest?.push({ type: 'MANIFEST', file: manifestFile });
	}

	static clearCache() {
		doodadCache.clear();
	}
}

export default WMOLegacyExporter;