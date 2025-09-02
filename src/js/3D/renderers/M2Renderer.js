/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
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
		const dataBoneIndices = new THREE.BufferAttribute(new Uint8Array(m2.boneIndices), 4);
		const dataBoneWeights = new THREE.BufferAttribute(new Uint8Array(m2.boneWeights), 4);

		this.uvData = new Float32Array(m2.uv);
		this.uv2Data = m2.uv2 ? new Float32Array(m2.uv2) : null;
		
		const allIndices = new Array(skin.triangles.length);
		for (let j = 0, m = allIndices.length; j < m; j++)
			allIndices[j] = skin.indices[skin.triangles[j]];

		this.indicesData = new Uint16Array(allIndices);

		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

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
	
			// if (m2.bones.length > 0) {
			// 	const skinnedMesh = new THREE.SkinnedMesh(geometry, this.materials);
			// 	this.meshGroup.add(skinnedMesh);

			// 	const bone_lookup_map = new Map();
			// 	const bones = [];

			// 	// Add bone nodes.
			// 	const rootNode = new THREE.Bone();
			// 	bones.push(rootNode);

			// 	const inverseBindMatrices = [];
			// 	//inverseBindMatrices.push([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
			// 	for (let i = 0; i < m2.bones.length; i++) {
			// 		//const nodeIndex = bones.length;
			// 		const bone = m2.bones[i];
					
			// 		const node = new THREE.Bone();

			// 		let parent_pos = [0, 0, 0];
			// 		if (bone.parentBone > -1) {
			// 			const parent_bone = m2.bones[bone.parentBone];
			// 			parent_pos = parent_bone.pivot;
			// 		}

			// 		var parentPos = bone.pivot.map((v, i) => v - parent_pos[i]);
			// 		node.position.x = parentPos[0];
			// 		node.position.y = parentPos[1];
			// 		node.position.z = parentPos[2];
		
			// 		bone_lookup_map.set(i, node);
		
			// 		if (bone.parentBone > -1) {
			// 			const parent_node = bone_lookup_map.get(bone.parentBone);
			// 			parent_node.add(node);
			// 		} else {
			// 			// Parent stray bones to the skeleton root.
			// 			rootNode.add(node);
			// 		}

			// 		bones.push(node);

			// 		inverseBindMatrices.push([vec3_to_mat4x4(bone.pivot)]);
		
			// 		//skin.joints.push(nodeIndex + 1);
			// 	}

			// 	const skeleton = new THREE.Skeleton( bones );

			// 	skinnedMesh.bind( skeleton );

			// 	// core.view.modelViewerContext.scene.add(new THREE.SkeletonHelper( bones[0] ));

			// } else {
			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
			// }

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

		this.renderCache.retire(...this.materials);

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;