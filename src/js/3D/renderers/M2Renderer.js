/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const GeosetMapper = require('../GeosetMapper');
const RenderCache = require('./RenderCache');

const textureRibbon = require('../../ui/texture-ribbon');

const DEFAULT_MODEL_COLOR = 0x57afe2;

class M2Renderer {
	/**
	 * Construct a new M2Renderer instance.
	 * @param {BufferWrapper} data 
	 * @param {THREE.Group} renderGroup
	 * @param {boolean} reactive
	 */
	constructor(data, renderGroup, reactive = false) {
		this.data = data;
		this.renderGroup = renderGroup;
		this.reactive = reactive;
		this.materials = [];
		this.renderCache = new RenderCache();
		this.syncID = -1;
		this.defaultMaterial = new THREE.MeshPhongMaterial({ name: 'default', color: DEFAULT_MODEL_COLOR, side: THREE.DoubleSide });
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load() {
		// Parse the M2 data.
		this.m2 = new M2Loader(this.data);
		await this.m2.load();

		if (this.m2.vertices.length > 0) {
			this.loadTextures();
			await this.loadSkin(0);

			if (this.reactive) {
				this.geosetWatcher = core.view.$watch('modelViewerGeosets', () => this.updateGeosets(), { deep: true });
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

		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

		for (let i = 0, n = skin.subMeshes.length; i < n; i++) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', dataVerts);
			geometry.setAttribute('normal', dataNorms);
			geometry.setAttribute('uv', dataUVs);

			// Map triangle array to indices.
			const index = new Array(skin.triangles.length);
			for (let j = 0, m = index.length; j < m; j++)
				index[j] = skin.indices[skin.triangles[j]];

			geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(index), 1));

			const skinMesh = skin.subMeshes[i];
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === i);
			geometry.addGroup(skinMesh.triangleStart, skinMesh.triangleCount, texUnit ? m2.textureCombos[texUnit.textureComboIndex] : null);

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));

			if (this.reactive) {
				const isDefault = (skinMesh.submeshID === 0 || skinMesh.submeshID.toString().endsWith('01'));
				this.geosetArray[i] = { label: 'Geoset ' + i, checked: isDefault, id: skinMesh.submeshID };
			}
		}

		if (this.reactive) {
			core.view.modelViewerGeosets = this.geosetArray;
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
	async overrideTextureType(type, fileDataID) {
		const textureTypes = this.m2.textureTypes;
		const renderWireframe = core.view.config.modelViewerWireframe;

		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] !== type)
				continue;

			const tex = new THREE.Texture();
			const loader = new THREE.ImageLoader();

			const data = await core.view.casc.getFile(fileDataID);
			const blp = new BLPFile(data);
			const blpURI = blp.getDataURL(0b0111);

			textureRibbon.setSlotFile(i, fileDataID, this.syncID);
			textureRibbon.setSlotSrc(i, blpURI, this.syncID);

			loader.load(blpURI, image => {
				tex.image = image;
				tex.format = THREE.RGBAFormat;
				tex.needsUpdate = true;
			});

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

		this.syncID = textureRibbon.reset();

		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];
			const ribbonSlot = textureRibbon.addSlot();

			if (texture.fileDataID > 0) {
				const tex = new THREE.Texture();
				const loader = new THREE.ImageLoader();

				textureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					const blpURI = blp.getDataURL(0b0111);
					textureRibbon.setSlotSrc(ribbonSlot, blpURI, this.syncID);

					loader.load(blpURI, image => {
						tex.image = image;
						tex.format = THREE.RGBAFormat;
						tex.needsUpdate = true;
					});
				}).catch(e => {
					log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
				});

				if (texture.flags & 0x1)
					tex.wrapS = THREE.RepeatWrapping;

				if (texture.flags & 0x2)
					tex.wrapT = THREE.RepeatWrapping;

				const material = new THREE.MeshPhongMaterial({ name: texture.fileDataID, map: tex, side: THREE.DoubleSide });
				this.renderCache.register(material, tex);

				this.materials[i] = material;
				this.renderCache.addUser(material);
			} else {
				this.materials[i] = this.defaultMaterial;
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