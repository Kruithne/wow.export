/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const M2AnimationConverter = require('../M2AnimationConverter');
const GeosetMapper = require('../GeosetMapper');
const ShaderMapper = require('../ShaderMapper');
const RenderCache = require('./RenderCache');

const textureRibbon = require('../../ui/texture-ribbon');

const DEFAULT_MODEL_COLOR = 0x57afe2;

class M2Renderer {
	/**
	 * Construct a new M2Renderer instance.
	 * @param {BufferWrapper} data 
	 * @param {THREE.Group} renderGroup
	 * @param {boolean} [reactive=false]
	 * @param {boolean} [useRibbon=true]
	 */
	constructor(data, renderGroup, reactive = false, useRibbon = true) {
		this.data = data;
		this.renderGroup = renderGroup;
		this.reactive = reactive;
		this.materials = [];
		this.renderCache = new RenderCache();
		this.syncID = -1;
		this.useRibbon = useRibbon;
		this.shaderMap = new Map();
		this.defaultMaterial = new THREE.MeshPhongMaterial({ name: 'default', color: DEFAULT_MODEL_COLOR, side: THREE.DoubleSide });
		this.geosetKey = 'modelViewerGeosets';
		this.uvData = null; // Store UV data for layer preview
		this.uv2Data = null; // Store secondary UV data for layer preview
		this.indicesData = null; // Store triangle indices for UV layer preview
		this.skeleton = null;
		this.animationMixer = null;
		this.animationClips = new Map();
		this.currentAnimation = null;
		this.boneHelper = null;
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load() {
		// Parse the M2 data.
		this.m2 = new M2Loader(this.data);
		await this.m2.load();

		this.loadTextures();

		if (this.m2.vertices.length > 0) {
			await this.loadSkin(0);

			if (this.reactive) {
				this.geosetWatcher = core.view.$watch(this.geosetKey, () => this.updateGeosets(), { deep: true });
				this.wireframeWatcher = core.view.$watch('config.modelViewerWireframe', () => this.updateWireframe(), { deep: true });
				this.bonesWatcher = core.view.$watch('config.modelViewerShowBones', () => this.updateBoneVisibility(), { deep: true });
			}
		}

		// Drop reference to raw data, we don't need it now.
		this.data = undefined;
	}

	/**
	 * Update the wireframe state for all materials.
	 */
	updateWireframe() {
		const renderWireframe = core.view.config.modelViewerWireframe;
		for (const material of this.materials) {
			material.wireframe = renderWireframe;
			material.needsUpdate = true;
		}
	}

	/**
	 * Update bone visibility based on config setting.
	 */
	updateBoneVisibility() {
		const showBones = core.view.config.modelViewerShowBones;
		
		if (showBones && this.skeleton && !this.boneHelper) {
			this.createBoneHelper();
		} else if (!showBones && this.boneHelper) {
			this.destroyBoneHelper();
		}
	}

	/**
	 * Create visual representation of bones.
	 */
	createBoneHelper() {
		if (!this.skeleton || this.boneHelper) 
			return;

		this.boneHelper = new THREE.Group();
		this.boneHelper.name = 'BoneHelper';

		const bones = this.skeleton.bones;
		
		for (let i = 0; i < bones.length; i++) {
			const bone = bones[i];

			for (const child of bone.children) {
				if (bones.includes(child)) {
					const lineGeometry = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(0, 0, 0), // Start at bone position
						child.position.clone() // End at child bone position
					]);
					
					const lineMaterial = new THREE.LineBasicMaterial({ 
						color: 0xffffff, 
						transparent: true, 
						opacity: 0.8,
						depthTest: false
					});
					const line = new THREE.Line(lineGeometry, lineMaterial);
					line.renderOrder = 998;
					
					bone.add(line);
				}
			}
		}
	}

	/**
	 * Remove bone helper visualization.
	 */
	destroyBoneHelper() {
		if (this.skeleton && this.boneHelper) {
			for (const bone of this.skeleton.bones) {
				const remove = [];
				for (const child of bone.children) {
					if (child.type === 'Mesh' || child.type === 'Line')
						remove.push(child);
				}
				
				for (const child of remove) {
					bone.remove(child);
					child.geometry?.dispose();
					child.material?.dispose();
				}
			}
			
			this.boneHelper = null;
		}
	}

	/**
	 * Update the current state of geosets.
	 */
	updateGeosets() {
		if (!this.reactive || !this.meshGroup || !this.geosetArray)
			return;

		const meshes = this.meshGroup.children;
		for (let i = 0, n = meshes.length; i < n; i++)
			meshes[i].visible = this.geosetArray[i].checked;
	}

	/**
	 * Load a skin with a given index.
	 */
	async loadSkin(index) {
		this.disposeMeshGroup();
		this.meshGroup = new THREE.Group();

		const m2 = this.m2;
		const skin = await m2.getSkin(index);

		const dataVerts = new THREE.BufferAttribute(new Float32Array(m2.vertices), 3);
		const dataNorms = new THREE.BufferAttribute(new Float32Array(m2.normals), 3);
		const dataUVs = new THREE.BufferAttribute(new Float32Array(m2.uv), 2);

		const boneIndicesFloat = new Float32Array(m2.boneIndices.length);
		for (let i = 0; i < m2.boneIndices.length; i++)
			boneIndicesFloat[i] = m2.boneIndices[i];

		const dataBoneIndices = new THREE.BufferAttribute(boneIndicesFloat, 4);
		
		// 0-255 -> 0-1
		const normalizedWeights = new Float32Array(m2.boneWeights.length);
		for (let i = 0; i < m2.boneWeights.length; i++)
			normalizedWeights[i] = m2.boneWeights[i] / 255.0;

		const dataBoneWeights = new THREE.BufferAttribute(normalizedWeights, 4);

		this.uvData = new Float32Array(m2.uv);
		this.uv2Data = m2.uv2 ? new Float32Array(m2.uv2) : null;
		
		const allIndices = new Array(skin.triangles.length);
		for (let j = 0, m = allIndices.length; j < m; j++)
			allIndices[j] = skin.indices[skin.triangles[j]];

		this.indicesData = new Uint16Array(allIndices);

		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

		this.createSkeleton();

		for (let i = 0, n = skin.subMeshes.length; i < n; i++) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', dataVerts);
			geometry.setAttribute('normal', dataNorms);
			geometry.setAttribute('uv', dataUVs);
			geometry.setAttribute('skinIndex', dataBoneIndices);
			geometry.setAttribute('skinWeight', dataBoneWeights);

			// Map triangle array to indices.
			const index = new Array(skin.triangles.length);
			for (let j = 0, m = index.length; j < m; j++)
				index[j] = skin.indices[skin.triangles[j]];

			geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(index), 1));

			const skinMesh = skin.subMeshes[i];
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === i);
			geometry.addGroup(skinMesh.triangleStart, skinMesh.triangleCount, texUnit ? m2.textureCombos[texUnit.textureComboIndex] : null);

			if (texUnit) {
				this.shaderMap.set(m2.textureTypes[m2.textureCombos[texUnit.textureComboIndex]], 
					{
						"VS": ShaderMapper.getVertexShader(texUnit.textureCount, texUnit.shaderID), 
						"PS": ShaderMapper.getPixelShader(texUnit.textureCount, texUnit.shaderID),
						"DS": ShaderMapper.getDomainShader(texUnit.textureCount, texUnit.shaderID),
						"HS": ShaderMapper.getHullShader(texUnit.textureCount, texUnit.shaderID)
					}
				);

				// console.log("TexUnit [" + i + "] Unit for geo " + skinMesh.submeshID + " material index " + texUnit.materialIndex + " has " + texUnit.textureCount + " textures", skinMesh, texUnit, m2.materials[texUnit.materialIndex]);
				// console.log("TexUnit Shaders [" + i + "]", this.shaderMap.get(m2.textureTypes[m2.textureCombos[texUnit.textureComboIndex]]));
			}
	
			if (this.skeleton && m2.bones.length > 0) {
				this.materials.forEach(mat => {
					if (mat instanceof THREE.MeshPhongMaterial) {
						mat.skinning = true;
						mat.needsUpdate = true;
					}
				});
				
				const skinnedMesh = new THREE.SkinnedMesh(geometry, this.materials);
				
				skinnedMesh.bindMatrix.identity();
				skinnedMesh.bindMatrixInverse.identity();
				
				skinnedMesh.bind(this.skeleton);
				
				this.meshGroup.add(skinnedMesh);
				log.write(`Created SkinnedMesh with ${m2.bones.length} bones, materials with skinning enabled`);
								
				if (!this.animationMixer && M2AnimationConverter.hasAnimations(m2))
					this.initializeAnimationMixer(skinnedMesh);
			} else {
				this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
				log.write('Created basic mesh (no skeleton');
			}

			if (this.reactive) {
				let isDefault = (skinMesh.submeshID === 0 || skinMesh.submeshID.toString().endsWith('01') || skinMesh.submeshID.toString().startsWith('32'));

				// Don't enable eyeglow/earrings by default
				if (skinMesh.submeshID.toString().startsWith('17') || skinMesh.submeshID.toString().startsWith('35'))
					isDefault = false;
	
				this.geosetArray[i] = { label: 'Geoset ' + i, checked: isDefault, id: skinMesh.submeshID };
			}
		}

		if (this.reactive) {
			core.view[this.geosetKey] = this.geosetArray;
			GeosetMapper.map(this.geosetArray);
		}

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);

		// Update geosets once (so defaults are applied correctly).
		this.updateGeosets();
	}

	/**
	 * Create skeleton from M2 bone data
	 */
	createSkeleton() {
		const m2 = this.m2;
			
		if (!m2 || !m2.bones || m2.bones.length === 0) {
			this.skeleton = null;
			return;
		}

		const boneLookupMap = new Map();
		const bones = [];

		for (let i = 0; i < m2.bones.length; i++) {
			const bone = m2.bones[i];
			const boneNode = new THREE.Bone();

			boneNode.name = bone.boneID >= 0 ? `bone_${bone.boneID}` : `bone_idx_${i}`;
			boneNode.position.set(bone.pivot[0], bone.pivot[1], bone.pivot[2]);
			
			boneNode.rotation.set(0, 0, 0);
			boneNode.scale.set(1, 1, 1);
			
			boneLookupMap.set(i, boneNode);
			bones.push(boneNode);
		}

		for (let i = 0; i < m2.bones.length; i++) {
			const boneData = m2.bones[i];
			const boneNode = boneLookupMap.get(i);
			
			if (boneData.parentBone >= 0 && boneData.parentBone < m2.bones.length) {
				const parentNode = boneLookupMap.get(boneData.parentBone);
				if (parentNode) {
					parentNode.add(boneNode);
					
					const parentBoneData = m2.bones[boneData.parentBone];
					boneNode.position.set(
						boneData.pivot[0] - parentBoneData.pivot[0],
						boneData.pivot[1] - parentBoneData.pivot[1], 
						boneData.pivot[2] - parentBoneData.pivot[2]
					);
				}
			}

			// ensure bone matrix is updated after position setup
			boneNode.updateMatrix();
		}

		this.skeleton = new THREE.Skeleton(bones);
		
		for (let i = 0; i < bones.length; i++) {
			if (!bones[i].parent)
				bones[i].updateMatrixWorld(true);
		}
		
		this.skeleton.boneInverses = [];
		for (let i = 0; i < bones.length; i++) {
			bones[i].updateMatrixWorld(true);
			const inverseBindMatrix = new THREE.Matrix4();
			inverseBindMatrix.copy(bones[i].matrixWorld).invert();
			this.skeleton.boneInverses.push(inverseBindMatrix);
		}

		if (this.reactive && core.view.config.modelViewerShowBones)
			this.createBoneHelper();
	}

	/**
	 * Initialize animation mixer and create animation clips
	 * @param {THREE.SkinnedMesh} skinnedMesh - The SkinnedMesh to bind the mixer to
	 */
	initializeAnimationMixer(skinnedMesh) {
		if (!this.skeleton || !skinnedMesh)
			return;

		this.animationRoot = new THREE.Group();
		this.animationRoot.name = 'AnimationRoot';
		
		for (const bone of this.skeleton.bones) {
			if (!bone.parent || !this.skeleton.bones.includes(bone.parent))
				this.animationRoot.add(bone);
		}
		
		this.renderGroup.add(this.animationRoot);

		this.animationMixer = new THREE.AnimationMixer(this.animationRoot);
		this.animationClips.clear();

		const animationList = M2AnimationConverter.getAnimationList(this.m2);
		for (const animInfo of animationList) {
			const clip = M2AnimationConverter.convertAnimation(this.m2, animInfo.index);
			if (clip)
				this.animationClips.set(animInfo.index, clip);
		}
	}

	/**
	 * Play animation by index
	 * @param {number} animationIndex - Index of animation to play
	 */
	playAnimation(animationIndex) {		
		if (!this.animationMixer || !this.animationClips.has(animationIndex))
			return;

		this.animationMixer.stopAllAction();
		
		const clip = this.animationClips.get(animationIndex);
		const action = this.animationMixer.clipAction(clip);
		action.setLoop(THREE.LoopRepeat);
		action.play();
		
		this.currentAnimation = animationIndex;
	}

	/**
	 * Stop current animation
	 */
	stopAnimation() {
		if (!this.animationMixer)
			return;

		this.animationMixer.stopAllAction();
		this.currentAnimation = null;
	}

	/**
	 * Update animation mixer
	 * @param {number} deltaTime - Delta time in seconds
	 */
	updateAnimation(deltaTime) {
		if (this.animationMixer) {
			this.animationMixer.update(deltaTime);
			
			this.meshGroup.traverse((child) => {
				if (child instanceof THREE.SkinnedMesh) {
					child.skeleton.update();
					child.updateMatrixWorld(true);
				}
			});
		}
	}

	/**
	 * Apply replaceable textures to this model.
	 * @param {Array} displays
	 */
	async applyReplaceableTextures(displays) {
		for (let i = 0, n = this.m2.textureTypes.length; i < n; i++) {
			const textureType = this.m2.textureTypes[i];
			if (textureType >= 11 && textureType < 14) {
				// Creature textures.
				this.overrideTextureType(textureType, displays.textures[textureType - 11]);
			} else if (textureType > 1 && textureType < 5) {
				// Item textures.
				this.overrideTextureType(textureType, displays.textures[textureType - 2]);
			}
		}
	}

	/**
	 * 
	 * @param {number} type 
	 * @param {number} fileDataID 
	 */
	async overrideTextureTypeWithCanvas(type, canvas) {
		const textureTypes = this.m2.textureTypes;
		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] !== type)
				continue;

			// i is the same as m2.textures[i]

			const tex = new THREE.CanvasTexture(canvas);

			tex.flipY = true;
			tex.magFilter = THREE.LinearFilter;
			tex.minFilter = THREE.LinearFilter;

			if (this.m2.textures[i].flags & 0x1)
				tex.wrapS = THREE.RepeatWrapping;

			if (this.m2.textures[i].flags & 0x2)
				tex.wrapT = THREE.RepeatWrapping;

			tex.colorSpace = THREE.SRGBColorSpace;

			// TODO: Use m2.materials[texUnit.materialIndex].flags & 0x4 to determine if it's double sided

			tex.needsUpdate = true;

			this.renderCache.retire(this.materials[i]);

			const material = new THREE.MeshPhongMaterial({ name: "URITexture", map: tex, side: THREE.DoubleSide });
			this.renderCache.register(material, tex);

			this.materials[i] = material;
			this.renderCache.addUser(material);
		}
	}

	/**
	 * 
	 * @param {number} type 
	 * @param {number} fileDataID 
	 */
	async overrideTextureType(type, fileDataID) {
		const textureTypes = this.m2.textureTypes;
		const renderWireframe = core.view.config.modelViewerWireframe;

		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] !== type)
				continue;

			const data = await core.view.casc.getFile(fileDataID);
			const blp = new BLPFile(data);

			if (this.useRibbon) {
				textureRibbon.setSlotFile(i, fileDataID, this.syncID);
				textureRibbon.setSlotSrc(i, blp.getDataURL(0b0111), this.syncID);
			}

			// Load DXT textures directly for performance boost for previews, disabled pending workaround for https://github.com/mrdoob/three.js/issues/4316 on our end or theirs
			// if (blp.encoding == 2) { 
			// 	const compressedTexture = new THREE.CompressedTexture();
			// 	compressedTexture.mipmaps = [];
			// 	compressedTexture.width = blp.width;
			// 	compressedTexture.height = blp.height;
			// 	compressedTexture.isCubemap = false;

			// 	for (let i = 0; i < blp.mapCount; i++) {
			// 		const scale = Math.pow(2, i);
			// 		compressedTexture.mipmaps.push({ data: blp.getRawMimap(i), width: blp.width / scale, height: blp.height / scale});
			// 	}

			// 	switch (blp.alphaEncoding) {
			// 		case 0: // DXT1
			// 			compressedTexture.format = blp.alphaDepth > 0 ? THREE.RGBA_S3TC_DXT1_Format : THREE.RGB_S3TC_DXT1_Format;
			// 			break;
			// 		case 1: // DXT3
			// 			compressedTexture.format = THREE.RGBA_S3TC_DXT3_Format;
			// 			break;
			// 		case 7: // DXT5
			// 			compressedTexture.format = THREE.RGBA_S3TC_DXT5_Format;
			// 			break;
			// 	}

			// 	compressedTexture.needsUpdate = true;

			// 	tex = compressedTexture;
			// }

			const tex = new THREE.DataTexture(blp.toUInt8Array(0, 0b0111), blp.width, blp.height, THREE.RGBAFormat);
			tex.flipY = true;
			tex.magFilter = THREE.LinearFilter;
			tex.minFilter = THREE.LinearFilter;

			if (this.m2.textures[i].flags & 0x1)
				tex.wrapS = THREE.RepeatWrapping;

			if (this.m2.textures[i].flags & 0x2)
				tex.wrapT = THREE.RepeatWrapping;

			tex.colorSpace = THREE.SRGBColorSpace;

			tex.needsUpdate = true;

			//TODO: Use m2.materials[texUnit.materialIndex].flags & 0x4 to determine if it's double sided

			this.renderCache.retire(this.materials[i]);

			const material = new THREE.MeshPhongMaterial({ name: fileDataID, map: tex, side: THREE.DoubleSide, wireframe: renderWireframe });
			this.renderCache.register(material, tex);

			this.materials[i] = material;
			this.renderCache.addUser(material);
		}
	}

	/**
	 * Load all textures needed for the M2 model.
	 */
	loadTextures() {
		const textures = this.m2.textures;

		this.renderCache.retire(...this.materials);
		this.materials = new Array(textures.length);

		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];

			const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;
			this.materials[i] = this.defaultMaterial;

			if (texture.fileDataID > 0) {
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					const tex = new THREE.DataTexture(blp.toUInt8Array(0, 0b0111), blp.width, blp.height, THREE.RGBAFormat);
					tex.magFilter = THREE.LinearFilter;
					tex.minFilter = THREE.LinearFilter;
					tex.flipY = true;
					tex.needsUpdate = true;
					
					if (ribbonSlot !== null)
						textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);

					if (texture.flags & 0x1)
						tex.wrapS = THREE.RepeatWrapping;
	
					if (texture.flags & 0x2)
						tex.wrapT = THREE.RepeatWrapping;

					tex.colorSpace = THREE.SRGBColorSpace;

					// TODO: Use m2.materials[texUnit.materialIndex].flags & 0x4 to determine if it's double sided
					
					const material = new THREE.MeshPhongMaterial({ name: texture.fileDataID, map: tex, side: THREE.DoubleSide });
					this.renderCache.register(material, tex);
	
					this.materials[i] = material;
					this.renderCache.addUser(material);
				}).catch(e => {
					log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
				});
			}
		}

		this.updateWireframe();
	}

	/**
	 * Dispose of all meshes controlled by this renderer.
	 */
	disposeMeshGroup() {
		// Clear out geoset controller.
		if (this.geosetArray)
			this.geosetArray.splice(0);

		// Clean up bone helper
		this.destroyBoneHelper();

		if (this.meshGroup) {
			// Remove this mesh group from the render group.
			this.renderGroup.remove(this.meshGroup);

			// Dispose of all children.
			for (const child of this.meshGroup.children)
				child.geometry.dispose();

			// Remove all children from the group for good measure.
			this.meshGroup.remove(...this.meshGroup.children);

			// Drop the reference to the mesh group.
			this.meshGroup = undefined;
		}
	}

	/**
	 * Get UV layer data for UV overlay generation.
	 * @returns {object} Object containing UV layers and indices data
	 */
	getUVLayers() {
		if (!this.uvData || !this.indicesData)
			return { layers: [], indices: null };

		const layers = [
			{ name: 'UV1', data: this.uvData, active: false }
		];

		if (this.uv2Data)
			layers.push({ name: 'UV2', data: this.uv2Data, active: false });

		return {
			layers,
			indices: this.indicesData
		};
	}

	/**
	 * Dispose of this instance and release all resources.
	 */
	dispose() {
		// Unregister reactive watchers.
		this.geosetWatcher?.();
		this.wireframeWatcher?.();
		this.bonesWatcher?.();

		this.renderCache.retire(...this.materials);

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;