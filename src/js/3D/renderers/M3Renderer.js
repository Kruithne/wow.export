/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M3Loader = require('../loaders/M3Loader');
const GeosetMapper = require('../GeosetMapper');
const ShaderMapper = require('../ShaderMapper');
const RenderCache = require('./RenderCache');

const textureRibbon = require('../../ui/texture-ribbon');

const DEFAULT_MODEL_COLOR = 0x57afe2;

class M3Renderer {
	/**
	 * Construct a new M3Renderer instance.
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
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load() {
		// Parse the M3 data.
		this.m3 = new M3Loader(this.data);
		await this.m3.load();
		await this.loadLOD(0);

		//this.loadTextures();

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
		return;
	}

	/**
	 * Load a LOD with a given index.
	 */
	async loadLOD(index) {
		this.disposeMeshGroup();
		this.meshGroup = new THREE.Group();

		// todo
		this.materials = new Array(0);
		this.materials.push(this.defaultMaterial);

		const m3 = this.m3;

		const dataVerts = new THREE.BufferAttribute(new Float32Array(m3.vertices), 3);
		const dataNorms = new THREE.BufferAttribute(new Float32Array(m3.normals), 3);
		const dataUVs = new THREE.BufferAttribute(new Float32Array(m3.uv), 2);

		// const dataBoneIndices = new THREE.BufferAttribute(new Uint8Array(m2.boneIndices), 4);
		// const dataBoneWeights = new THREE.BufferAttribute(new Uint8Array(m2.boneWeights), 4);

		// if (this.reactive)
		// 	this.geosetArray = new Array(skin.subMeshes.length);

	
		for (let lodIndex = 0; lodIndex < m3.lodLevels.length; lodIndex++) {
			if (lodIndex != index)
				continue;

			for (let geosetIndex = m3.geosetCountPerLOD * lodIndex; geosetIndex < (m3.geosetCountPerLOD * (lodIndex + 1)); geosetIndex++) {
				const geoset = m3.geosets[geosetIndex];
				const geosetName = m3.stringBlock.slice(geoset.nameCharStart, geoset.nameCharStart + geoset.nameCharCount);
				log.write("Rendering geoset " + geosetIndex + " (" + geosetName + ")");

				// geometry.setAttribute('skinIndex', dataBoneIndices);
				// geometry.setAttribute('skinWeight', dataBoneWeights);

				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute('position', dataVerts);
				geometry.setAttribute('normal', dataNorms);
				geometry.setAttribute('uv', dataUVs);

				const dataIndices = new THREE.BufferAttribute(new Uint16Array(m3.indices.slice(geoset.indexStart, geoset.indexStart + geoset.indexCount)), 1);
				geometry.setIndex(dataIndices);

				// TODO: We can re-use the same buffers with geometry.addGroup
				// geometry.addGroup(geoset.indexStart, geoset.indexCount, 0);

				// this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
				this.meshGroup.add(new THREE.Mesh(geometry, this.defaultMaterial));
			}
		}

		// if (this.reactive) {
		// 	core.view[this.geosetKey] = this.geosetArray;
		// 	GeosetMapper.map(this.geosetArray);
		// }

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
		return;
	}

	/**
	 * 
	 * @param {number} type 
	 * @param {number} fileDataID 
	 */
	async overrideTextureTypeWithCanvas(type, canvas) {
		return;
	}

	/**
	 * 
	 * @param {number} type 
	 * @param {number} fileDataID 
	 */
	async overrideTextureType(type, fileDataID) {
		return;
	}

	/**
	 * Load all textures needed for the M3 model.
	 */
	loadTextures() {
		return;
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

module.exports = M3Renderer;