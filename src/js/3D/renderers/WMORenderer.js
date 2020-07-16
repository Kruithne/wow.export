/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const Texture = require('../Texture');
const WMOLoader = require('../loaders/WMOLoader');
const M2Renderer = require('./M2Renderer');
const listfile = require('../../casc/listfile');

const DEFAULT_MATERIAL = new THREE.MeshPhongMaterial({ color: 0x57afe2 });

class WMORenderer {
	/**
	 * Construct a new WMORenderer instance.
	 * @param {BufferWrapper} data 
	 * @param {string|number} fileID
	 * @param {THREE.Group} renderGroup
	 */
	constructor(data, fileID, renderGroup) {
		this.data = data;
		this.fileID = fileID;
		this.renderGroup = renderGroup;
		this.textures = [];
		this.m2Renderers = new Map();
		this.m2Clones = [];
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load() {
		// Parse the WMO data.
		const wmo = this.wmo = new WMOLoader(this.data, this.fileID);
		await wmo.load();
		await this.loadTextures();

		this.meshGroup = new THREE.Group();
		this.groupArray = [];

		for (let i = 0, n = wmo.groupCount; i < n; i++) {
			const group = await wmo.getGroup(i);

			// Skip empty groups?
			if (!group.renderBatches || group.renderBatches.length === 0)
				continue;

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(group.vertices), 3));
			geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(group.normals), 3));

			if (group.uvs)
				geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(group.uvs[0]), 2));

			geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(group.indices), 1));

			// Load all render batches into the mesh.
			for (const batch of group.renderBatches) {
				const matID = batch.flags === 2 ? batch.possibleBox2[2] : batch.materialID;
				geometry.addGroup(batch.firstFace, batch.numFaces, matID);
			}

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
			this.groupArray.push({ label: wmo.groupNames[group.nameOfs], checked: true, groupIndex: i });
		}

		const setCount = wmo.doodadSets.length;
		this.setArray = new Array(setCount);
		this.doodadSets = new Array(setCount);
		for (let i = 0; i < setCount; i++)
			this.setArray[i] = { label: wmo.doodadSets[i].name, index: i, checked: false };

		// Set-up reactive controls.
		const view = core.view;
		view.modelViewerWMOGroups = this.groupArray;
		view.modelViewerWMOSets = this.setArray;
		this.groupWatcher = view.$watch('modelViewerWMOGroups', () => this.updateGroups(), { deep: true });
		this.setWatcher = view.$watch('modelViewerWMOSets', () => this.updateSets(), { deep: true });

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);

		// Drop reference to raw data, we don't need it now.
		this.data = undefined;
	}

	/**
	 * Load all textures needed for the WMO model.
	 */
	loadTextures() {
		const wmo = this.wmo;
		const materialCount = wmo.materials.length;
		const materials = this.materials = new Array(materialCount);

		const isClassic = !!wmo.textureNames;
		for (let i = 0; i < materialCount; i++) {
			const material = wmo.materials[i];
			const texture = new Texture(material.flags);

			if (isClassic)
				texture.setFileName(wmo.textureNames[material.texture1]);
			else
				texture.fileDataID = material.texture1;

			if (texture.fileDataID > 0) {
				const tex = new THREE.Texture();
				const loader = new THREE.ImageLoader();

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					loader.load(blp.getDataURL(false), image => {
						tex.image = image;
						tex.format = THREE.RGBAFormat;
						tex.needsUpdate = true;
					});
				}).catch(e => {
					log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
				});

				if (!(texture.flags & 0x40))
					tex.wrapS = THREE.RepeatWrapping;

				if (!(texture.flags & 0x80))
					tex.wrapT = THREE.RepeatWrapping;

				this.textures.push(tex);
				materials[i] = new THREE.MeshPhongMaterial({ map: tex });
			} else {
				materials[i] = DEFAULT_MATERIAL;
			}
		}
	}

	/**
	 * Load a doodad set for this WMO.
	 * @param {number} index 
	 */
	async loadDoodadSet(index) {
		const wmo = this.wmo;
		const set = wmo.doodadSets[index];
		const casc = core.view.casc;

		if (!set)
			throw new Error('Invalid doodad set requested: %s', index);

		log.write('Loading doodad set: %s', set.name);

		const renderGroup = new THREE.Group();

		const firstIndex = set.firstInstanceIndex;
		const count = set.doodadCount;

		core.view.isBusy++;
		core.setToast('progress', util.format('Loading doodad set %s (%d doodads)...', set.name, count), null, -1, false);

		for (let i = 0; i < count; i++) {
			const doodad = wmo.doodads[firstIndex + i];
			let fileDataID = 0;

			if (wmo.fileDataIDs)
				fileDataID = wmo.fileDataIDs[doodad.offset];
			else
				fileDataID = listfile.getByFilename(wmo.doodadNames[doodad.offset]) || 0;

			if (fileDataID > 0) {
				try {
					let mesh;
					if (this.m2Renderers.has(fileDataID)) {
						// We already built this m2, re-use it.
						mesh = this.m2Renderers.get(fileDataID).meshGroup.clone(true);
						renderGroup.add(mesh);
						this.m2Clones.push(mesh);
					} else {
						// New M2, load it from CASC and prepare for render.
						const data = await casc.getFile(fileDataID);
						const m2 = new M2Renderer(data, renderGroup);
						
						await m2.load();
						await m2.loadSkin(0);

						mesh = m2.meshGroup;
						this.m2Renderers.set(fileDataID, m2);
					}

					// Apply relative position/rotation/scale.
					const pos = doodad.position;
					mesh.position.set(pos[0], pos[2], pos[1] * -1);

					const rot = doodad.rotation;
					mesh.quaternion.set(rot[0], rot[2], rot[1] * -1, rot[3]);

					mesh.scale.set(doodad.scale, doodad.scale, doodad.scale);
				} catch (e) {
					log.write('Failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
				}
			}
		}

		this.renderGroup.add(renderGroup);
		this.doodadSets[index] = renderGroup;

		core.hideToast();
		core.view.isBusy--;
	}

	/**
	 * Update the visibility status of WMO groups.
	 */
	updateGroups() {
		if (!this.meshGroup || !this.groupArray)
			return;

		const meshes = this.meshGroup.children;
		for (let i = 0, n = meshes.length; i < n; i++)
			meshes[i].visible = this.groupArray[i].checked;
	}

	/**
	 * Update the visibility status of doodad sets.
	 */
	async updateSets() {
		if (!this.wmo || !this.setArray)
			return;

		const sets = this.doodadSets;
		for (let i = 0, n = sets.length; i < n; i++) {
			const state = this.setArray[i].checked;
			const set = sets[i];

			if (set)
				set.visible = state;
			else if (state)
				await this.loadDoodadSet(i);
		}
	}

	/**
	 * Dispose of this instance and release all resources.
	 */
	dispose() {
		if (this.meshGroup) {
			// Remove this mesh group from the render group.
			this.renderGroup.remove(this.meshGroup);

			// Dispose of all children.
			for (const child of this.meshGroup.children)
				child.geometry.dispose();

			// Remove all children from the group for good measure.
			this.meshGroup.remove(...this.meshGroup.children);

			// Drop the reference to the mesh group.
			this.meshGroup = null;
		}

		// Dispose of all M2 renderers for doodad sets.
		for (const renderer of this.m2Renderers.values())
			renderer.dispose();

		// Remove M2 clones from the renderGroup.
		for (const clone of this.m2Clones)
			this.renderGroup.remove(clone);

		// Remove doodad set containers from renderGroup.
		// In theory, these should now be empty is M2 renderers dispose correctly.
		for (const set of this.doodadSets)
			this.renderGroup.remove(set);

		// Dereference M2 renderers for faster clean-up.
		this.m2Renderers = undefined;
		this.m2Clones = undefined;

		// Unregister reactive watchers.
		if (this.groupWatcher) this.groupWatcher();
		if (this.setWatcher) this.setWatcher();

		// Empty reactive arrays.
		if (this.groupArray) this.groupArray.splice(0);
		if (this.setArray) this.setArray.splice(0);

		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();
	}
}

module.exports = WMORenderer;