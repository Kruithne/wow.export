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
const M2Loader= require('../loaders/M2Loader');
const SKELLoader = require('../loaders/SKELLoader');
const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const JSONWriter = require('../writers/JSONWriter');
const GLTFWriter = require('../writers/GLTFWriter');
const GeosetMapper = require('../GeosetMapper');
const ExportHelper = require('../../casc/export-helper');
const BufferWrapper = require('../../buffer');

class M2Exporter {
	/**
	 * Construct a new M2Exporter instance.
	 * @param {BufferWrapper}
	 * @param {Array} variantTextures
	 * @param {number} fileDataID
	 */
	constructor(data, variantTextures, fileDataID) {
		this.m2 = new M2Loader(data);
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
		const config = core.view.config;
		const validTextures = new Map();

		if (!config.modelsExportTextures)
			return validTextures;

		await this.m2.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';

		let textureIndex = 0;

		// Export data textures first.
		for (const [textureName, dataTexture] of this.dataTextures) {
			try {
				let texFile = 'data-' + textureName + '.png';
				let texPath = path.join(out, texFile);

				const matName = 'mat_' + textureName;

				if (config.overwriteFiles || !await generics.fileExists(texPath)) {
					const data = BufferWrapper.fromBase64(dataTexture.replace(/^data[^,]+,/,''));
					log.write('Exporting data texture %d -> %s', textureName, texPath);
					await data.writeToFile(texPath);
				} else {
					log.write('Skipping data texture export %s (file exists, overwrite disabled)', texPath);
				}

				if (usePosix)
					texFile = ExportHelper.win32ToPosix(texFile);

				mtl?.addMaterial(matName, texFile);
				validTextures.set('data-' + textureName, {
					matName: fullTexPaths ? texFile : matName,
					matPathRelative: texFile,
					matPath: texPath
				});
			} catch (e) {
				log.write('Failed to export data texture %d for M2: %s', textureName, e.message);
			}

			textureIndex++;
		}

		for (const texture of this.m2.textures) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			const textureType = this.m2.textureTypes[textureIndex];
			let texFileDataID = texture.fileDataID;

			//TODO: Use m2.materials[texUnit.materialIndex].flags & 0x4 to determine if it's double sided
			
			if (textureType > 0) {
				let targetFileDataID = 0;

				if (this.dataTextures.has(textureType)) {
					// Not a fileDataID, but a data texture.
					targetFileDataID = 'data-' + textureType;
				} else if (textureType >= 11 && textureType < 14) {
					// Creature textures.
					targetFileDataID = this.variantTextures[textureType - 11];
				} else if (textureType > 1 && textureType < 5) {
					targetFileDataID = this.variantTextures[textureType - 2];
				}

				texFileDataID = targetFileDataID;

				// Backward patch the variant texture into the M2 instance so that
				// the MTL exports with the correct texture once we swap it here.
				texture.fileDataID = targetFileDataID;
			}

			if (!Number.isNaN(texFileDataID) && texFileDataID > 0) {
				try {
					let texFile = texFileDataID + (raw ? '.blp' : '.png');
					let texPath = path.join(out, texFile);

					// Default MTL name to the file ID (prefixed for Maya).
					let matName = 'mat_' + texFileDataID;
					let fileName = listfile.getByID(texFileDataID);

					if (fileName !== undefined) {
						matName = 'mat_' + path.basename(fileName.toLowerCase(), '.blp');

						// Remove spaces from material name for MTL compatibility.
						if (core.view.config.removePathSpaces)
							matName = matName.replace(/\s/g, '');
					}

					// Map texture files relative to its own path.
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
						texFile = path.relative(out, texPath);
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);

						if (raw === true) {
							// Write raw BLP files.
							await data.writeToFile(texPath);
						} else {
							// Convert BLP to PNG.
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha? 0b1111 : 0b0111);
						}
					} else {
						log.write('Skipping M2 texture export %s (file exists, overwrite disabled)', texPath);
					}

					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					mtl?.addMaterial(matName, texFile);
					validTextures.set(texFileDataID, {
						matName: fullTexPaths ? texFile : matName,
						matPathRelative: texFile,
						matPath: texPath
					});
				} catch (e) {
					log.write('Failed to export texture %d for M2: %s', texFileDataID, e.message);
				}
			}

			textureIndex++;
		}

		return validTextures;
	}

	async exportAsGLTF(out, helper, format = 'gltf') {
		const ext = format === 'glb' ? '.glb' : '.gltf';
		const outGLTF = ExportHelper.replaceExtension(out, ext);
		const outDir = path.dirname(out);

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && await generics.fileExists(outGLTF))
			return log.write('Skipping %s export of %s (already exists, overwrite disabled)', format.toUpperCase(), outGLTF);

		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const model_name = path.basename(outGLTF, ext);
		const gltf = new GLTFWriter(out, model_name);
		log.write('Exporting M2 model %s as %s: %s', model_name, format.toUpperCase(), outGLTF);

		if (this.m2.skeletonFileID) {
			const skel_file = await core.view.casc.getFile(this.m2.skeletonFileID);
			const skel = new SKELLoader(skel_file);

			await skel.load();

			if (core.view.config.modelsExportAnimations)
				await skel.loadAnims();

			if (skel.parent_skel_file_id > 0) {
				const parent_skel_file = await core.view.casc.getFile(skel.parent_skel_file_id);
				const parent_skel = new SKELLoader(parent_skel_file);
				await parent_skel.load();

				if (core.view.config.modelsExportAnimations) {
					await parent_skel.loadAnims();

					// Map of animation indices from child to parent.
					const animIndexMap = new Map();

					for (let i = 0; i < skel.animations.length; i++) {
						const anim = skel.animations[i];
						for (let j = 0; j < parent_skel.animations.length; j++) {
							const parent_anim = parent_skel.animations[j];
							if (parent_anim.id === anim.id && parent_anim.variationIndex === anim.variationIndex) {
								animIndexMap.set(i, j);
								break;
							}
						}
					}

					// Override parent bone animation data with child skeleton animation data if animation is present on both.
					for (let i = 0; i < skel.bones.length; i++) {
						if (i >= parent_skel.bones.length) 
							break;

						const bone = skel.bones[i];
						const parentBone = parent_skel.bones[i];

						for (const anim of animIndexMap) {
							if (bone.translation.timestamps.length > anim[0] && parentBone.translation.timestamps.length > anim[1])
								parent_skel.bones[i].translation.timestamps[anim[1]] = bone.translation.timestamps[anim[0]];

							if (bone.translation.values.length > anim[0] && parentBone.translation.values.length > anim[1])
								parent_skel.bones[i].translation.values[anim[1]] = bone.translation.values[anim[0]];

							if (bone.rotation.timestamps.length > anim[0] && parentBone.rotation.timestamps.length > anim[1])
								parent_skel.bones[i].rotation.timestamps[anim[1]] = bone.rotation.timestamps[anim[0]];

							if (bone.rotation.values.length > anim[0] && parentBone.rotation.values.length > anim[1])
								parent_skel.bones[i].rotation.values[anim[1]] = bone.rotation.values[anim[0]];

							if (bone.scale.timestamps.length > anim[0] && parentBone.scale.timestamps.length > anim[1])
								parent_skel.bones[i].scale.timestamps[anim[1]] = bone.scale.timestamps[anim[0]];

							if (bone.scale.values.length > anim[0] && parentBone.scale.values.length > anim[1])
								parent_skel.bones[i].scale.values[anim[1]] = bone.scale.values[anim[0]];
						}
					}

					gltf.setAnimations(parent_skel.animations);
				}

				gltf.setBonesArray(parent_skel.bones);
			} else {
				if (core.view.config.modelsExportAnimations)
					gltf.setAnimations(skel.animations);

				gltf.setBonesArray(skel.bones);
			}

		} else {
			if (core.view.config.modelsExportAnimations) {
				await this.m2.loadAnims();
				gltf.setAnimations(this.m2.animations);
			}

			gltf.setBonesArray(this.m2.bones);
		}

		gltf.setVerticesArray(this.m2.vertices);
		gltf.setNormalArray(this.m2.normals);
		gltf.setBoneWeightArray(this.m2.boneWeights);
		gltf.setBoneIndexArray(this.m2.boneIndices)

		gltf.addUVArray(this.m2.uv);
		gltf.addUVArray(this.m2.uv2);

		const textureMap = await this.exportTextures(outDir, false, null, helper, true);
		gltf.setTextureMap(textureMap);

		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			// Skip geosets that are not enabled.
			if (this.geosetMask && !this.geosetMask[mI]?.checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const indices = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				indices[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			let texture = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit)
				texture = this.m2.textures[this.m2.textureCombos[texUnit.textureComboIndex]];

			let matName;
			if (texture?.fileDataID && textureMap.has(texture.fileDataID))
				matName = textureMap.get(texture.fileDataID).matName;

			if (this.dataTextures.has(this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]])) {
				const dataTextureKey = 'data-' + this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]];
				if (textureMap.has(dataTextureKey))
					matName = textureMap.get(dataTextureKey).matName;
			}

			gltf.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), indices, matName);
		}

		await gltf.write(core.view.config.overwriteFiles, format);
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {ExportHelper} helper
	 * @param {Array} fileManifest
	 */
	async exportAsOBJ(out, exportCollision = false, helper, fileManifest) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = core.view.config;
		const exportMeta = core.view.config.exportM2Meta;
		const exportBones = core.view.config.exportM2Bones;

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		const outDir = path.dirname(out);

		// Use internal M2 name or fallback to the OBJ file name.
		const model_name = path.basename(out, '.obj');
		obj.setName(model_name);

		log.write('Exporting M2 model %s as OBJ: %s', model_name, out);

		// Verts, normals, UVs
		obj.setVertArray(this.m2.vertices);
		obj.setNormalArray(this.m2.normals);
		obj.addUVArray(this.m2.uv);

		if (core.view.config.modelsExportUV2)
			obj.addUVArray(this.m2.uv2);

		// Textures
		const validTextures = await this.exportTextures(outDir, false, mtl, helper);
		for (const [texFileDataID, texInfo] of validTextures)
			fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texInfo.matPath });

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		// Export bone data to a separate JSON file due to the excessive size.
		// A normal meta-data file is around 8kb without bones, 65mb with bones.
		if (exportBones) {
			const json = new JSONWriter(ExportHelper.replaceExtension(out, '_bones.json'));

			if (this.m2.skeletonFileID) {
				const skel_file = await core.view.casc.getFile(this.m2.skeletonFileID);
				const skel = new SKELLoader(skel_file);
	
				await skel.load();
	
				if (skel.parent_skel_file_id > 0) {
					const parent_skel_file = await core.view.casc.getFile(skel.parent_skel_file_id);
					const parent_skel = new SKELLoader(parent_skel_file);
					await parent_skel.load();
	
					json.addProperty('bones', parent_skel.bones);
				} else {
					json.addProperty('bones', skel.bones);
				}
	
			} else {
				json.addProperty('bones', this.m2.bones);
			}

			json.addProperty('boneWeights', this.m2.boneWeights);
			json.addProperty('boneIndicies', this.m2.boneIndices);

			await json.write(config.overwriteFiles);
		}

		if (exportMeta) {
			const json = new JSONWriter(ExportHelper.replaceExtension(out, '.json'));

			// Clone the submesh array and add a custom 'enabled' property
			// to indicate to external readers which submeshes are not included
			// in the actual geometry file.
			const subMeshes = Array(skin.subMeshes.length);
			for (let i = 0, n = subMeshes.length; i < n; i++) {
				const subMeshEnabled = !this.geosetMask || this.geosetMask[i].checked;
				subMeshes[i] = Object.assign({ enabled: subMeshEnabled }, skin.subMeshes[i]);
			}

			// Clone M2 textures array and expand the entries to include internal
			// and external paths/names for external convenience. GH-208
			const textures = new Array(this.m2.textures.length);
			for (let i = 0, n = textures.length; i < n; i++) {
				const texture = this.m2.textures[i];
				const textureEntry = validTextures.get(texture.fileDataID);

				textures[i] = Object.assign({
					fileNameInternal: listfile.getByID(texture.fileDataID),
					fileNameExternal: textureEntry?.matPathRelative,
					mtlName: textureEntry?.matName
				}, texture);
			}

			json.addProperty('fileType', 'm2');
			json.addProperty('fileDataID', this.fileDataID);
			json.addProperty('fileName', listfile.getByID(this.fileDataID));
			json.addProperty('internalName', this.m2.name);
			json.addProperty('textures', textures);
			json.addProperty('textureTypes', this.m2.textureTypes);
			json.addProperty('materials', this.m2.materials);
			json.addProperty('textureCombos', this.m2.textureCombos);
			json.addProperty('skeletonFileID', this.m2.skeletonFileID);
			json.addProperty('boneFileIDs', this.m2.boneFileIDs);
			json.addProperty('animFileIDs', this.m2.animFileIDs);
			json.addProperty('colors', this.m2.colors);
			json.addProperty('textureWeights', this.m2.textureWeights);
			json.addProperty('transparencyLookup', this.m2.transparencyLookup);
			json.addProperty('textureTransforms', this.m2.textureTransforms);
			json.addProperty('textureTransformsLookup', this.m2.textureTransformsLookup);
			json.addProperty('boundingBox', this.m2.boundingBox);
			json.addProperty('boundingSphereRadius', this.m2.boundingSphereRadius);
			json.addProperty('collisionBox', this.m2.collisionBox);
			json.addProperty('collisionSphereRadius', this.m2.collisionSphereRadius);
			json.addProperty('skin', {
				subMeshes: subMeshes,
				textureUnits: skin.textureUnits,
				fileName: skin.fileName,
				fileDataID: skin.fileDataID
			});

			await json.write(config.overwriteFiles);
			fileManifest?.push({ type: 'META', fileDataID: this.fileDataID, file: json.out });
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
			if (texture?.fileDataID > 0 && validTextures.has(texture.fileDataID))
				matName = validTextures.get(texture.fileDataID).matName;

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		fileManifest?.push({ type: 'OBJ', fileDataID: this.fileDataID, file: obj.out });

		await mtl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'MTL', fileDataID: this.fileDataID, file: mtl.out });

		if (exportCollision) {
			const phys = new OBJWriter(ExportHelper.replaceExtension(out, '.phys.obj'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices);

			await phys.write(config.overwriteFiles);
			fileManifest?.push({ type: 'PHYS_OBJ', fileDataID: this.fileDataID, file: phys.out });
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
		const casc = core.view.casc;
		const config = core.view.config;

		const manifestFile = ExportHelper.replaceExtension(out, '.manifest.json');
		const manifest = new JSONWriter(manifestFile);

		manifest.addProperty('fileDataID', this.fileDataID);

		// Write the M2 file with no conversion.
		await this.m2.data.writeToFile(out);
		fileManifest?.push({ type: 'M2', fileDataID: this.fileDataID, file: out });

		// Only load M2 data if we need to export related files.
		if (config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone || config.modelsExportAnim)
			await this.m2.load();

		// Directory that relative files should be exported to.
		const outDir = path.dirname(out);

		// Write relative skin files.
		if (config.modelsExportSkin) {
			const textures = await this.exportTextures(outDir, true, null, helper);
			const texturesManifest = [];
			for (const [texFileDataID, texInfo] of textures) {
				texturesManifest.push({ fileDataID: texFileDataID, file: path.relative(outDir, texInfo.matPath) });
				fileManifest?.push({ type: 'BLP', fileDataID: texFileDataID, file: texInfo.matPath });
			}

			manifest.addProperty('textures', texturesManifest);

			const exportSkins = async (skins, typeName, manifestName) => {
				const skinsManifest = [];
				for (const skin of skins) {
					// Abort if the export has been cancelled.
					if (helper.isCancelled())
						return;
	
					const skinData = await casc.getFile(skin.fileDataID);

					let skinFile;
					if (config.enableSharedChildren)
						skinFile = ExportHelper.getExportPath(skin.fileName);
					else
						skinFile = path.join(outDir, path.basename(skin.fileName));
	
					await skinData.writeToFile(skinFile);
					skinsManifest.push({ fileDataID: skin.fileDataID, file: path.relative(outDir, skinFile) });
					fileManifest?.push({ type: typeName, fileDataID: skin.fileDataID, file: skinFile });
				}

				manifest.addProperty(manifestName, skinsManifest);
			};

			await exportSkins(this.m2.getSkinList(), 'SKIN', 'skins');
			await exportSkins(this.m2.lodSkins, 'LOD_SKIN', 'lodSkins');			
		}

		// Write relative skeleton files.
		if (config.modelsExportSkel && this.m2.skeletonFileID) {
			const skelData = await casc.getFile(this.m2.skeletonFileID);
			const skelFileName = listfile.getByID(this.m2.skeletonFileID);

			let skelFile;
			if (config.enableSharedChildren)
				skelFile = ExportHelper.getExportPath(skelFileName);
			else
				skelFile = path.join(outDir, path.basename(skelFileName));

			await skelData.writeToFile(skelFile);
			manifest.addProperty('skeleton', { fileDataID: this.m2.skeletonFileID, file: path.relative(outDir, skelFile) });
			fileManifest?.push({ type: 'SKEL', fileDataID: this.m2.skeletonFileID, file: skelFile });

			const skel = new SKELLoader(skelData);
			await skel.load();

			if (config.modelsExportAnim) {
				await skel.loadAnims();
				if (config.modelsExportAnim && skel.animFileIDs) {
					const animManifest = [];
					const animCache = new Set();
					for (const anim of skel.animFileIDs) {
						if (anim.fileDataID > 0 && !animCache.has(anim.fileDataID)) {
							const animData = await casc.getFile(anim.fileDataID);
							const animFileName = listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
							
							let animFile;
							if (config.enableSharedChildren)
								animFile = ExportHelper.getExportPath(animFileName);
							else
								animFile = path.join(outDir, path.basename(animFileName));

							await animData.writeToFile(animFile);
							animManifest.push({ fileDataID: anim.fileDataID, file: path.relative(outDir, animFile), animID: anim.animID, subAnimID: anim.subAnimID });
							fileManifest?.push({ type: 'ANIM', fileDataID: anim.fileDataID, file: animFile });
							animCache.add(anim.fileDataID);
						}
					}

					manifest.addProperty('skelAnims', animManifest);
				}

				if (config.modelsExportBone && skel.boneFileIDs) {
					const boneManifest = [];
					for (let i = 0, n = skel.boneFileIDs.length; i < n; i++) {
						const boneFileID = skel.boneFileIDs[i];
						const boneData = await casc.getFile(boneFileID);
						const boneFileName = listfile.getByIDOrUnknown(boneFileID, '.bone');
		
						let boneFile;
						if (config.enableSharedChildren)
							boneFile = ExportHelper.getExportPath(boneFileName);
						else
							boneFile = path.join(outDir, path.basename(boneFileName));
		
						await boneData.writeToFile(boneFile);
						boneManifest.push({ fileDataID: boneFileID, file: path.relative(outDir, boneFile) });
						fileManifest?.push({ type: 'BONE', fileDataID: boneFileID, file: boneFile });
					}
		
					manifest.addProperty('skelBones', boneManifest);
				}
			}

			if (skel.parent_skel_file_id > 0) {
				const parentSkelData = await core.view.casc.getFile(skel.parent_skel_file_id);
				const parentSkelFileName = listfile.getByID(skel.parent_skel_file_id);
	
				let parentSkelFile;
				if (config.enableSharedChildren)
					parentSkelFile = ExportHelper.getExportPath(parentSkelFileName);
				else
					parentSkelFile = path.join(outDir, path.basename(parentSkelFileName));
	
				await parentSkelData.writeToFile(parentSkelFile);
	
				manifest.addProperty('parentSkeleton', { fileDataID: skel.parent_skel_file_id, file: path.relative(outDir, parentSkelFile) });
				fileManifest?.push({ type: 'PARENT_SKEL', fileDataID: skel.parent_skel_file_id, file: parentSkelFile });
	
				const parentSkel = new SKELLoader(parentSkelData);
				await parentSkel.load();

				if (config.modelsExportAnim) {
					await parentSkel.loadAnims();
					if (config.modelsExportAnim && parentSkel.animFileIDs) {
						const animManifest = [];
						const animCache = new Set();
						for (const anim of parentSkel.animFileIDs) {
							if (anim.fileDataID > 0 && !animCache.has(anim.fileDataID)) {
								const animData = await casc.getFile(anim.fileDataID);
								const animFileName = listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
								
								let animFile;
								if (config.enableSharedChildren)
									animFile = ExportHelper.getExportPath(animFileName);
								else
									animFile = path.join(outDir, path.basename(animFileName));
	
								await animData.writeToFile(animFile);
								animManifest.push({ fileDataID: anim.fileDataID, file: path.relative(outDir, animFile), animID: anim.animID, subAnimID: anim.subAnimID });
								fileManifest?.push({ type: 'ANIM', fileDataID: anim.fileDataID, file: animFile });
								animCache.add(anim.fileDataID);
							}
						}
	
						manifest.addProperty('parentSkelAnims', animManifest);
					}
				}

				if (config.modelsExportBone && parentSkel.boneFileIDs) {
					const boneManifest = [];
					for (let i = 0, n = parentSkel.boneFileIDs.length; i < n; i++) {
						const boneFileID = parentSkel.boneFileIDs[i];
						const boneData = await casc.getFile(boneFileID);
						const boneFileName = listfile.getByIDOrUnknown(boneFileID, '.bone');
		
						let boneFile;
						if (config.enableSharedChildren)
							boneFile = ExportHelper.getExportPath(boneFileName);
						else
							boneFile = path.join(outDir, path.basename(boneFileName));
		
						await boneData.writeToFile(boneFile);
						boneManifest.push({ fileDataID: boneFileID, file: path.relative(outDir, boneFile) });
						fileManifest?.push({ type: 'BONE', fileDataID: boneFileID, file: boneFile });
					}
		
					manifest.addProperty('parentSkelBones', boneManifest);
				}
			}
		}

		// Write relative bone files.
		if (config.modelsExportBone && this.m2.boneFileIDs) {
			const boneManifest = [];
			for (let i = 0, n = this.m2.boneFileIDs.length; i < n; i++) {
				const boneFileID = this.m2.boneFileIDs[i];
				const boneData = await casc.getFile(boneFileID);
				const boneFileName = listfile.getByIDOrUnknown(boneFileID, '.bone');

				let boneFile;
				if (config.enableSharedChildren)
					boneFile = ExportHelper.getExportPath(boneFileName);
				else
					boneFile = path.join(outDir, path.basename(boneFileName));

				await boneData.writeToFile(boneFile);
				boneManifest.push({ fileDataID: boneFileID, file: path.relative(outDir, boneFile) });
				fileManifest?.push({ type: 'BONE', fileDataID: boneFileID, file: boneFile });
			}

			manifest.addProperty('bones', boneManifest);
		}

		// Write relative animation files.
		if (config.modelsExportAnim && this.m2.animFileIDs) {
			const animManifest = [];
			const animCache = new Set();
			for (const anim of this.m2.animFileIDs) {
				if (anim.fileDataID > 0 && !animCache.has(anim.fileDataID)) {
					const animData = await casc.getFile(anim.fileDataID);
					const animFileName = listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
					
					let animFile;
					if (config.enableSharedChildren)
						animFile = ExportHelper.getExportPath(animFileName);
					else
						animFile = path.join(outDir, path.basename(animFileName));

					await animData.writeToFile(animFile);
					animManifest.push({ fileDataID: anim.fileDataID, file: path.relative(outDir, animFile), animID: anim.animID, subAnimID: anim.subAnimID });
					fileManifest?.push({ type: 'ANIM', fileDataID: anim.fileDataID, file: animFile });
					animCache.add(anim.fileDataID);
				}
			}

			manifest.addProperty('anims', animManifest);
		}

		await manifest.write();
	}
}

module.exports = M2Exporter;