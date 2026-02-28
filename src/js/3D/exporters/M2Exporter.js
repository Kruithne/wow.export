/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
import { listfile } from '../../../views/main/rpc.js';
import BLPFile from '../../casc/blp.js';
import generics from '../../generics.js';
import ExportHelper from '../../export-helper.js';
import GeosetMapper from '../GeosetMapper.js';
import SKELLoader from '../loaders/SKELLoader.js';
import JSONWriter from '../writers/JSONWriter.js';
import MTLWriter from '../writers/MTLWriter.js';
import EquipmentSlots from '../../wow/EquipmentSlots.js';
import core from '../../core.js';
import M2Loader from '../loaders/M2Loader.js';
import OBJWriter from '../writers/OBJWriter.js';
import STLWriter from '../writers/STLWriter.js';
import GLTFWriter from '../writers/GLTFWriter.js';
import log from '../../log.js';
import BufferWrapper from '../../buffer.js';
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
	 * Set posed geometry to use instead of bind pose
	 * @param {Float32Array} vertices
	 * @param {Float32Array} normals
	 */
	setPosedGeometry(vertices, normals) {
		this.posedVertices = vertices;
		this.posedNormals = normals;
	}

	/**
	 * Export additional texture from canvas
	 */
	async addURITexture(out, dataURI) {
		this.dataTextures.set(out, dataURI);
	}

	/**
	 * Set equipment models to export alongside the main model (for OBJ/STL).
	 * @param {Array<{slot_id, item_id, renderer, vertices, normals, uv, uv2, textures}>} equipment
	 */
	setEquipmentModels(equipment) {
		this.equipmentModels = equipment;
	}

	/**
	 * Set equipment models for GLTF export (with bone data for rigging).
	 * @param {Array<{slot_id, item_id, renderer, vertices, normals, uv, uv2, boneIndices, boneWeights, textures, is_collection_style}>} equipment
	 */
	setEquipmentModelsGLTF(equipment) {
		this.equipmentModelsGLTF = equipment;
	}

	/**
	 * Export the textures for this M2 model (for GLB mode, returns buffers instead of writing).
	 * @param {string} out
	 * @param {boolean} raw
	 * @param {MTLWriter} mtl
	 * @param {exporter} helper
	 * @param {boolean} [fullTexPaths=false]
	 * @param {boolean} [glbMode=false]
	 * @returns {Map<number, string>}
	 */
	async exportTextures(out, raw = false, mtl = null, helper, fullTexPaths = false, glbMode = false) {
		const config = core.view.config;
		const validTextures = new Map();
		const texture_buffers = new Map();
		const files_to_cleanup = [];

		if (!config.modelsExportTextures)
			return glbMode ? { validTextures, texture_buffers, files_to_cleanup } : validTextures;

		await this.m2.load();

		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';

		let textureIndex = 0;

		// Export data textures first.
		for (const [textureName, dataTexture] of this.dataTextures) {
			try {
				let texFile = 'data-' + textureName + '.png';
				let texPath = out + '/' + texFile;
				const matName = 'mat_' + textureName;
				const data = BufferWrapper.fromBase64(dataTexture.replace(/^data[^,]+,/,''));

				if (glbMode) {
					texture_buffers.set('data-' + textureName, data);
					log.write('Buffering data texture %d for GLB embedding', textureName);
				} else if (config.overwriteFiles || !await generics.fileExists(texPath)) {
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
					let texPath = out + '/' + texFile;

					// Default MTL name to the file ID (prefixed for Maya).
					let matName = 'mat_' + texFileDataID;
					let fileName = await listfile.getByID(texFileDataID);

					if (fileName !== undefined) {
						matName = 'mat_' + fileName.toLowerCase().split('/').pop().replace('.blp', '');

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
						texFile = texPath.replace(out, '');
					}

					const file_existed = await generics.fileExists(texPath);

					if (glbMode && !raw) {
						// glb mode: convert to PNG buffer without writing
						const data = await core.view.casc.getFile(texFileDataID);
						const blp = new BLPFile(data);
						const png_buffer = blp.toPNG(useAlpha ? 0b1111 : 0b0111);
						texture_buffers.set(texFileDataID, png_buffer);
						log.write('Buffering M2 texture %d for GLB embedding', texFileDataID);

						if (!file_existed)
							files_to_cleanup.push(texPath);
					} else if (config.overwriteFiles || !file_existed) {
						const data = await core.view.casc.getFile(texFileDataID);
						log.write('Exporting M2 texture %d -> %s', texFileDataID, texPath);

						if (raw === true) {
							// write raw BLP files
							await data.writeToFile(texPath);
						} else {
							// convert BLP to PNG
							const blp = new BLPFile(data);
							await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111);
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

		if (glbMode)
			return { validTextures, texture_buffers, files_to_cleanup };

		return validTextures;
	}

	async exportAsGLTF(out, helper, format = 'gltf') {
		const ext = format === 'glb' ? '.glb' : '.gltf';
		const outGLTF = ExportHelper.replaceExtension(out, ext);
		const outDir = out.substring(0, out.lastIndexOf('/'));

		// Skip export if file exists and overwriting is disabled.
		if (!core.view.config.overwriteFiles && await generics.fileExists(outGLTF))
			return log.write('Skipping %s export of %s (already exists, overwrite disabled)', format.toUpperCase(), outGLTF);

		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const model_name = outGLTF.split('/').pop().replace(ext, '');
		const gltf = new GLTFWriter(out, model_name);
		log.write('Exporting M2 model %s as %s: %s', model_name, format.toUpperCase(), outGLTF);

		if (this.m2.skeletonFileID) {
			const skel_file = await core.view.casc.getFile(this.m2.skeletonFileID);
			const skel = new SKELLoader(skel_file);

			await skel.load();

			if (skel.parent_skel_file_id > 0) {
				const parent_skel_file = await core.view.casc.getFile(skel.parent_skel_file_id);
				const parent_skel = new SKELLoader(parent_skel_file);
				await parent_skel.load();

				if (core.view.config.modelsExportAnimations) {
					// load each skeleton's .anim files independently
					// each skeleton's bone offsets match its own .anim data
					await parent_skel.loadAnims();
					await skel.loadAnims();

					// identify which animations come from the child skeleton
					const child_anim_keys = new Set();
					if (skel.animFileIDs) {
						for (const entry of skel.animFileIDs) {
							if (entry.fileDataID > 0)
								child_anim_keys.add(`${entry.animID}-${entry.subAnimID}`);
						}
					}

					// copy child bone animation data into parent bones for child-specific animations
					const bone_count = Math.min(parent_skel.bones.length, skel.bones.length);
					for (let i = 0; i < parent_skel.animations.length; i++) {
						const anim = parent_skel.animations[i];
						if (!child_anim_keys.has(`${anim.id}-${anim.variationIndex}`))
							continue;

						// find matching animation index in child skeleton
						let child_idx = -1;
						for (let j = 0; j < skel.animations.length; j++) {
							if (skel.animations[j].id === anim.id && skel.animations[j].variationIndex === anim.variationIndex) {
								child_idx = j;
								break;
							}
						}

						if (child_idx < 0)
							continue;

						// copy decoded keyframe data from child bones into parent bones
						for (let bi = 0; bi < bone_count; bi++) {
							const pb = parent_skel.bones[bi];
							const cb = skel.bones[bi];

							for (const track of ['translation', 'rotation', 'scale']) {
								if (cb[track].timestamps[child_idx]?.length > 0) {
									pb[track].timestamps[i] = cb[track].timestamps[child_idx];
									pb[track].values[i] = cb[track].values[child_idx];
								}
							}
						}
					}

					gltf.setAnimations(parent_skel.animations);
				}

				gltf.setBonesArray(parent_skel.bones);
			} else {
				if (core.view.config.modelsExportAnimations) {
					await skel.loadAnims();
					gltf.setAnimations(skel.animations);
				}

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

		let textureMap;
		if (format === 'glb') {
			const result = await this.exportTextures(outDir, false, null, helper, true, true);
			textureMap = result.validTextures;
			gltf.setTextureBuffers(result.texture_buffers);
		} else {
			textureMap = await this.exportTextures(outDir, false, null, helper, true, false);
		}

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

		// add equipment models for GLTF export
		if (this.equipmentModelsGLTF && this.equipmentModelsGLTF.length > 0) {
			for (const equip of this.equipmentModelsGLTF) {
				await this._addEquipmentToGLTF(gltf, equip, textureMap, outDir, format, helper);
			}
		}

		await gltf.write(core.view.config.overwriteFiles, format);
	}

	/**
	 * Add equipment model to GLTF writer.
	 * @private
	 */
	async _addEquipmentToGLTF(gltf, equip, textureMap, outDir, format, helper) {
		const { slot_id, item_id, renderer, vertices, normals, uv, uv2, boneIndices, boneWeights, textures, is_collection_style } = equip;

		if (!renderer?.m2)
			return;

		const m2 = renderer.m2;
		await m2.load();

		const skin = await m2.getSkin(0);
		if (!skin)
			return;

		const slot_name = EquipmentSlots.get_slot_name(slot_id) || `Slot${slot_id}`;

		// export equipment textures and build material map
		const config = core.view.config;
		const equipTextures = new Map();

		if (config.modelsExportTextures && textures) {
			for (let i = 0; i < textures.length; i++) {
				const texFileDataID = textures[i];
				if (!texFileDataID || texFileDataID <= 0)
					continue;

				// use existing texture if already exported
				if (textureMap.has(texFileDataID)) {
					equipTextures.set(i, textureMap.get(texFileDataID));
					continue;
				}

				try {
					const fileName = await listfile.getByID(texFileDataID);
					let matName = 'mat_equip_' + texFileDataID;
					let texFile = texFileDataID + '.png';
					let texPath = outDir + '/' + texFile;

					if (fileName !== undefined) {
						matName = 'mat_' + fileName.toLowerCase().split('/').pop().replace('.blp', '');
						if (config.removePathSpaces)
							matName = matName.replace(/\s/g, '');
					}

					if (config.enableSharedTextures && fileName !== undefined) {
						const sharedFileName = ExportHelper.replaceExtension(fileName, '.png');
						texPath = ExportHelper.getExportPath(sharedFileName);
						texFile = texPath.replace(outDir, '');
					}

					// for glb mode, we need to get the texture buffer
					if (format === 'glb') {
						const data = await core.view.casc.getFile(texFileDataID);
						const blp = new BLPFile(data);
						const png_buffer = await blp.toPNG(config.modelsExportAlpha ? 0b1111 : 0b0111);

						gltf.texture_buffers.set(texFileDataID, png_buffer);
					} else if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						const blp = new BLPFile(data);
						await blp.saveToPNG(texPath, config.modelsExportAlpha ? 0b1111 : 0b0111);
					}

					const usePosix = config.pathFormat === 'posix';
					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					const texInfo = { matName, matPathRelative: texFile, matPath: texPath };
					textureMap.set(texFileDataID, texInfo);
					equipTextures.set(i, texInfo);
				} catch (e) {
					log.write('Failed to export equipment GLTF texture %d: %s', texFileDataID, e.message);
				}
			}
		}

		// build meshes for this equipment
		const meshes = [];
		let mesh_idx = 0;

		for (let mI = 0; mI < skin.subMeshes.length; mI++) {
			// check visibility via draw_calls if available
			if (renderer.draw_calls && renderer.draw_calls[mI] && !renderer.draw_calls[mI].visible)
				continue;

			const mesh = skin.subMeshes[mI];
			const triangles = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				triangles[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			// find texture for this submesh
			let matName = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit) {
				const textureIdx = m2.textureCombos[texUnit.textureComboIndex];
				const texture = m2.textures[textureIdx];
				const textureType = m2.textureTypes[textureIdx];

				// check for replaceable texture
				if (textureType >= 11 && textureType < 14) {
					const texInfo = equipTextures.get(textureType - 11);
					if (texInfo)
						matName = texInfo.matName;
				} else if (textureType > 1 && textureType < 5) {
					const texInfo = equipTextures.get(textureType - 2);
					if (texInfo)
						matName = texInfo.matName;
				} else if (texture?.fileDataID > 0 && textureMap.has(texture.fileDataID)) {
					matName = textureMap.get(texture.fileDataID).matName;
				}
			}

			meshes.push({
				name: `${mesh_idx++}`,
				triangles,
				matName
			});
		}

		// add equipment to GLTF
		gltf.addEquipmentModel({
			name: `${slot_name}_Item${item_id}`,
			vertices: vertices,
			normals: normals,
			uv: uv,
			uv2: uv2,
			boneIndices: is_collection_style ? boneIndices : null,
			boneWeights: is_collection_style ? boneWeights : null,
			meshes
		});

		log.write('Added equipment GLTF meshes for slot %d (item %d)', slot_id, item_id);
	}

	/**
	 * Export equipment model geometry and textures to OBJ/MTL.
	 * @private
	 */
	async _exportEquipmentToOBJ(obj, mtl, outDir, equip, validTextures, helper, fileManifest) {
		const config = core.view.config;
		const useAlpha = config.modelsExportAlpha;
		const usePosix = config.pathFormat === 'posix';
		const { slot_id, item_id, renderer, vertices, normals, uv, uv2, textures } = equip;

		if (!renderer?.m2)
			return;

		const m2 = renderer.m2;
		await m2.load();

		const skin = await m2.getSkin(0);
		if (!skin)
			return;

		// build UV arrays
		const uvArrays = [];
		if (uv)
			uvArrays.push(uv);

		if (config.modelsExportUV2 && uv2)
			uvArrays.push(uv2);

		// append geometry to OBJ
		obj.appendGeometry(vertices, normals, uvArrays);

		// export equipment textures and build material map
		const equipTextures = new Map();
		if (config.modelsExportTextures && textures) {
			for (let i = 0; i < textures.length; i++) {
				const texFileDataID = textures[i];
				if (!texFileDataID || texFileDataID <= 0)
					continue;

				// skip if already exported
				if (validTextures.has(texFileDataID)) {
					equipTextures.set(i, validTextures.get(texFileDataID));
					continue;
				}

				try {
					let texFile = texFileDataID + '.png';
					let texPath = outDir + '/' + texFile;
					let matName = 'mat_equip_' + texFileDataID;

					const fileName = await listfile.getByID(texFileDataID);
					if (fileName !== undefined) {
						matName = 'mat_' + fileName.toLowerCase().split('/').pop().replace('.blp', '');
						if (config.removePathSpaces)
							matName = matName.replace(/\s/g, '');
					}

					if (config.enableSharedTextures && fileName !== undefined) {
						const sharedFileName = ExportHelper.replaceExtension(fileName, '.png');
						texPath = ExportHelper.getExportPath(sharedFileName);
						texFile = texPath.replace(outDir, '');
					}

					if (config.overwriteFiles || !await generics.fileExists(texPath)) {
						const data = await core.view.casc.getFile(texFileDataID);
						const blp = new BLPFile(data);
						await blp.saveToPNG(texPath, useAlpha ? 0b1111 : 0b0111);
						log.write('Exported equipment texture %d -> %s', texFileDataID, texPath);
					}

					if (usePosix)
						texFile = ExportHelper.win32ToPosix(texFile);

					mtl.addMaterial(matName, texFile);
					const texInfo = { matName, matPathRelative: texFile, matPath: texPath };
					validTextures.set(texFileDataID, texInfo);
					equipTextures.set(i, texInfo);
					fileManifest?.push({ type: 'PNG', fileDataID: texFileDataID, file: texPath });
				} catch (e) {
					log.write('Failed to export equipment texture %d: %s', texFileDataID, e.message);
				}
			}
		}

		// add equipment meshes
		const slot_name = EquipmentSlots.get_slot_name(slot_id) || `Slot${slot_id}`;
		let mesh_idx = 0;

		for (let mI = 0; mI < skin.subMeshes.length; mI++) {
			// check visibility via draw_calls if available
			if (renderer.draw_calls && renderer.draw_calls[mI] && !renderer.draw_calls[mI].visible)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			// find texture for this submesh
			let matName = null;
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === mI);
			if (texUnit) {
				const textureIdx = m2.textureCombos[texUnit.textureComboIndex];
				const texture = m2.textures[textureIdx];
				const textureType = m2.textureTypes[textureIdx];

				// check for replaceable texture
				if (textureType >= 11 && textureType < 14) {
					const texInfo = equipTextures.get(textureType - 11);
					if (texInfo)
						matName = texInfo.matName;
				} else if (textureType > 1 && textureType < 5) {
					const texInfo = equipTextures.get(textureType - 2);
					if (texInfo)
						matName = texInfo.matName;
				} else if (texture?.fileDataID > 0 && validTextures.has(texture.fileDataID)) {
					matName = validTextures.get(texture.fileDataID).matName;
				}
			}

			const meshName = `${slot_name}_Item${item_id}_${mesh_idx++}`;
			obj.addMesh(meshName, verts, matName);
		}

		log.write('Added equipment meshes for slot %d (item %d)', slot_id, item_id);
	}

	/**
	 * Export equipment model geometry to STL.
	 * @private
	 */
	async _exportEquipmentToSTL(stl, equip, helper) {
		const { slot_id, item_id, renderer, vertices, normals } = equip;

		if (!renderer?.m2)
			return;

		const m2 = renderer.m2;
		await m2.load();

		const skin = await m2.getSkin(0);
		if (!skin)
			return;

		// append geometry to STL
		stl.appendGeometry(vertices, normals);

		// add equipment meshes
		const slot_name = EquipmentSlots.get_slot_name(slot_id) || `Slot${slot_id}`;
		let mesh_idx = 0;

		for (let mI = 0; mI < skin.subMeshes.length; mI++) {
			// check visibility via draw_calls if available
			if (renderer.draw_calls && renderer.draw_calls[mI] && !renderer.draw_calls[mI].visible)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			const meshName = `${slot_name}_Item${item_id}_${mesh_idx++}`;
			stl.addMesh(meshName, verts);
		}

		log.write('Added equipment STL meshes for slot %d (item %d)', slot_id, item_id);
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {exporter} helper
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

		const outDir = out.substring(0, out.lastIndexOf('/'));

		// Use internal M2 name or fallback to the OBJ file name.
		const model_name = out.split('/').pop().replace('.obj', '');
		obj.setName(model_name);

		log.write('Exporting M2 model %s as OBJ: %s', model_name, out);

		// verts, normals, UVs - use posed geometry if available
		obj.setVertArray(this.posedVertices ?? this.m2.vertices);
		obj.setNormalArray(this.posedNormals ?? this.m2.normals);
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
					fileNameInternal: await listfile.getByID(texture.fileDataID),
					fileNameExternal: textureEntry?.matPathRelative,
					mtlName: textureEntry?.matName
				}, texture);
			}

			json.addProperty('fileType', 'm2');
			json.addProperty('fileDataID', this.fileDataID);
			json.addProperty('fileName', await listfile.getByID(this.fileDataID));
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

			if (texUnit && this.dataTextures.has(this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]])) {
				const dataTextureKey = 'data-' + this.m2.textureTypes[this.m2.textureCombos[texUnit.textureComboIndex]];
				if (validTextures.has(dataTextureKey))
					matName = validTextures.get(dataTextureKey).matName;
			}

			obj.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts, matName);
		}

		// export equipment models if present
		if (this.equipmentModels && this.equipmentModels.length > 0) {
			for (const equip of this.equipmentModels) {
				if (helper.isCancelled())
					return;

				await this._exportEquipmentToOBJ(obj, mtl, outDir, equip, validTextures, helper, fileManifest);
			}
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(mtl.out.split('/').pop());

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
	 * Export the M2 model as an STL file.
	 * @param {string} out
	 * @param {boolean} exportCollision
	 * @param {exporter} helper
	 * @param {Array} fileManifest
	 */
	async exportAsSTL(out, exportCollision = false, helper, fileManifest) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const config = core.view.config;

		const stl = new STLWriter(out);
		const model_name = out.split('/').pop().replace('.stl', '');
		stl.setName(model_name);

		log.write('Exporting M2 model %s as STL: %s', model_name, out);

		// verts, normals - use posed geometry if available
		stl.setVertArray(this.posedVertices ?? this.m2.vertices);
		stl.setNormalArray(this.posedNormals ?? this.m2.normals);

		// abort if the export has been cancelled
		if (helper.isCancelled())
			return;

		// faces
		for (let mI = 0, mC = skin.subMeshes.length; mI < mC; mI++) {
			// skip geosets that are not enabled
			if (this.geosetMask && !this.geosetMask[mI].checked)
				continue;

			const mesh = skin.subMeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indices[skin.triangles[mesh.triangleStart + vI]];

			stl.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts);
		}

		// export equipment models if present
		if (this.equipmentModels && this.equipmentModels.length > 0) {
			for (const equip of this.equipmentModels) {
				if (helper.isCancelled())
					return;

				await this._exportEquipmentToSTL(stl, equip, helper);
			}
		}

		await stl.write(config.overwriteFiles);
		fileManifest?.push({ type: 'STL', fileDataID: this.fileDataID, file: stl.out });

		if (exportCollision) {
			const phys = new STLWriter(ExportHelper.replaceExtension(out, '.phys.stl'));
			phys.setVertArray(this.m2.collisionPositions);
			phys.setNormalArray(this.m2.collisionNormals);
			phys.addMesh('Collision', this.m2.collisionIndices);

			await phys.write(config.overwriteFiles);
			fileManifest?.push({ type: 'PHYS_STL', fileDataID: this.fileDataID, file: phys.out });
		}
	}

	/**
	 * Export the model as a raw M2 file, including related files
	 * such as textures, bones, animations, etc.
	 * @param {string} out 
	 * @param {exporter} helper 
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
		const outDir = out.substring(0, out.lastIndexOf('/'));

		// Write relative skin files.
		if (config.modelsExportSkin) {
			const textures = await this.exportTextures(outDir, true, null, helper);
			const texturesManifest = [];
			for (const [texFileDataID, texInfo] of textures) {
				texturesManifest.push({ fileDataID: texFileDataID, file: texInfo.matPath.replace(outDir, '') });
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
						skinFile = outDir + '/' + skin.fileName.split('/').pop();
	
					await skinData.writeToFile(skinFile);
					skinsManifest.push({ fileDataID: skin.fileDataID, file: skinFile.replace(outDir, '') });
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
			const skelFileName = await listfile.getByID(this.m2.skeletonFileID);

			let skelFile;
			if (config.enableSharedChildren)
				skelFile = ExportHelper.getExportPath(skelFileName);
			else
				skelFile = outDir + '/' + skelFileName.split('/').pop();

			await skelData.writeToFile(skelFile);
			manifest.addProperty('skeleton', { fileDataID: this.m2.skeletonFileID, file: skelFile.replace(outDir, '') });
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
							const animFileName = await listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
							
							let animFile;
							if (config.enableSharedChildren)
								animFile = ExportHelper.getExportPath(animFileName);
							else
								animFile = outDir + '/' + animFileName.split('/').pop();

							await animData.writeToFile(animFile);
							animManifest.push({ fileDataID: anim.fileDataID, file: animFile.replace(outDir, ''), animID: anim.animID, subAnimID: anim.subAnimID });
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
						const boneFileName = await listfile.getByIDOrUnknown(boneFileID, '.bone');
		
						let boneFile;
						if (config.enableSharedChildren)
							boneFile = ExportHelper.getExportPath(boneFileName);
						else
							boneFile = outDir + '/' + boneFileName.split('/').pop();
		
						await boneData.writeToFile(boneFile);
						boneManifest.push({ fileDataID: boneFileID, file: boneFile.replace(outDir, '') });
						fileManifest?.push({ type: 'BONE', fileDataID: boneFileID, file: boneFile });
					}
		
					manifest.addProperty('skelBones', boneManifest);
				}
			}

			if (skel.parent_skel_file_id > 0) {
				const parentSkelData = await core.view.casc.getFile(skel.parent_skel_file_id);
				const parentSkelFileName = await listfile.getByID(skel.parent_skel_file_id);
	
				let parentSkelFile;
				if (config.enableSharedChildren)
					parentSkelFile = ExportHelper.getExportPath(parentSkelFileName);
				else
					parentSkelFile = outDir + '/' + parentSkelFileName.split('/').pop();
	
				await parentSkelData.writeToFile(parentSkelFile);
	
				manifest.addProperty('parentSkeleton', { fileDataID: skel.parent_skel_file_id, file: parentSkelFile.replace(outDir, '') });
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
								const animFileName = await listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
								
								let animFile;
								if (config.enableSharedChildren)
									animFile = ExportHelper.getExportPath(animFileName);
								else
									animFile = outDir + '/' + animFileName.split('/').pop();
	
								await animData.writeToFile(animFile);
								animManifest.push({ fileDataID: anim.fileDataID, file: animFile.replace(outDir, ''), animID: anim.animID, subAnimID: anim.subAnimID });
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
						const boneFileName = await listfile.getByIDOrUnknown(boneFileID, '.bone');
		
						let boneFile;
						if (config.enableSharedChildren)
							boneFile = ExportHelper.getExportPath(boneFileName);
						else
							boneFile = outDir + '/' + boneFileName.split('/').pop();
		
						await boneData.writeToFile(boneFile);
						boneManifest.push({ fileDataID: boneFileID, file: boneFile.replace(outDir, '') });
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
				const boneFileName = await listfile.getByIDOrUnknown(boneFileID, '.bone');

				let boneFile;
				if (config.enableSharedChildren)
					boneFile = ExportHelper.getExportPath(boneFileName);
				else
					boneFile = outDir + '/' + boneFileName.split('/').pop();

				await boneData.writeToFile(boneFile);
				boneManifest.push({ fileDataID: boneFileID, file: boneFile.replace(outDir, '') });
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
					const animFileName = await listfile.getByIDOrUnknown(anim.fileDataID, '.anim');
					
					let animFile;
					if (config.enableSharedChildren)
						animFile = ExportHelper.getExportPath(animFileName);
					else
						animFile = outDir + '/' + animFileName.split('/').pop();

					await animData.writeToFile(animFile);
					animManifest.push({ fileDataID: anim.fileDataID, file: animFile.replace(outDir, ''), animID: anim.animID, subAnimID: anim.subAnimID });
					fileManifest?.push({ type: 'ANIM', fileDataID: anim.fileDataID, file: animFile });
					animCache.add(anim.fileDataID);
				}
			}

			manifest.addProperty('anims', animManifest);
		}

		await manifest.write();
	}
}

export default M2Exporter;