/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const util = require('util');
const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const Texture = require('../Texture');
const WMOLoader = require('../loaders/WMOLoader');
const M2Renderer = require('./M2Renderer');
const M3Renderer = require('./M3Renderer');
const listfile = require('../../casc/listfile');
const textureRibbon = require('../../ui/texture-ribbon');
const constants = require('../../constants');

const DEFAULT_MATERIAL = new THREE.MeshPhongMaterial({ color: 0x57afe2, side: THREE.DoubleSide });

class WMORenderer {
	/**
	 * Construct a new WMORenderer instance.
	 * @param {BufferWrapper} data 
	 * @param {string|number} fileID
	 * @param {THREE.Group} renderGroup
	 * @param {boolean} [useRibbon=true]
	 */
	constructor(data, fileID, renderGroup, useRibbon = true) {
		this.data = data;
		this.fileID = fileID;
		this.renderGroup = renderGroup;
		this.textures = [];
		this.modelRenderers = new Map();
		this.m2Clones = [];
		this.useRibbon = useRibbon;
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load() {
		// Parse the WMO data.
		const wmo = this.wmo = new WMOLoader(this.data, this.fileID, true);
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
				const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;
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
		this.wireframeWatcher = view.$watch('config.modelViewerWireframe', () => this.updateWireframe(), { deep: true });

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);

		// Update wireframe rendering.
		this.updateWireframe();

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

		this.syncID = textureRibbon.reset();

		const isClassic = !!wmo.textureNames;
		for (let i = 0; i < materialCount; i++) {
			const material = wmo.materials[i];
			const texture = new Texture(material.flags);

			if (isClassic) {
				texture.setFileName(wmo.textureNames[material.texture1]);
			}
			else
			{
				if (material.shader == 23)
					texture.fileDataID = material.texture2;
				else
					texture.fileDataID = material.texture1;
			}

			materials[i] = DEFAULT_MATERIAL;

			if (texture.fileDataID > 0) {
				const ribbonSlot = textureRibbon.addSlot();
				textureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					const tex = new THREE.DataTexture(blp.toUInt8Array(0, 0b0111), blp.width, blp.height, THREE.RGBAFormat);
					tex.flipY = true;
					tex.magFilter = THREE.LinearFilter;
					tex.minFilter = THREE.LinearFilter;

					if (!(texture.flags & 0x40))
						tex.wrapS = THREE.RepeatWrapping;

					if (!(texture.flags & 0x80))
						tex.wrapT = THREE.RepeatWrapping;

					tex.needsUpdate = true;

					this.textures.push(tex);
					materials[i] = new THREE.MeshPhongMaterial({ map: tex, side: THREE.DoubleSide });

					if (this.useRibbon) {
						const blpURI = blp.getDataURL(0b0111);
						textureRibbon.setSlotSrc(ribbonSlot, blpURI, this.syncID);
					}
				}).catch(e => {
					log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
				});
			} else {
				materials[i] = DEFAULT_MATERIAL;
			}

			// Include texture2/texture3 in the texture ribbon.
			this.loadAuxiliaryTextureForRibbon(material.texture2, wmo);
			this.loadAuxiliaryTextureForRibbon(material.texture3, wmo);

			if (material.shader == 23) {
				this.loadAuxiliaryTextureForRibbon(material.color3, wmo);
				this.loadAuxiliaryTextureForRibbon(material.runtimeData[0], wmo);
				this.loadAuxiliaryTextureForRibbon(material.runtimeData[1], wmo);
				this.loadAuxiliaryTextureForRibbon(material.runtimeData[2], wmo);
				this.loadAuxiliaryTextureForRibbon(material.runtimeData[3], wmo);
			}
		}
	}

	/**
	 * Load an auxiliary texture onto the texture ribbon.
	 * @param {number|string} textureID 
	 * @param {WMOLoader} wmo
	 */
	async loadAuxiliaryTextureForRibbon(textureID, wmo) {
		if (!this.useRibbon)
			return;

		if (wmo.textureNames)
			textureID = listfile.getByFilename(textureID) || 0;

		if (textureID > 0) {
			const ribbonSlot = textureRibbon.addSlot();
			textureRibbon.setSlotFile(ribbonSlot, textureID, this.syncID);

			const data = await core.view.casc.getFile(textureID);
			const blp = new BLPFile(data);

			textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(), this.syncID);
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
					if (this.modelRenderers.has(fileDataID)) {
						// We already built this m2, re-use it.
						mesh = this.modelRenderers.get(fileDataID).meshGroup.clone(true);
						renderGroup.add(mesh);
						this.m2Clones.push(mesh);
					} else {
						// New model, load it from CASC and prepare for render.
						const data = await casc.getFile(fileDataID);

						const modelMagic = data.readUInt32LE();
						data.seek(0);
						if (modelMagic == constants.MAGIC.MD21) {
							const m2 = new M2Renderer(data, renderGroup, false, false);
							await m2.load();
							await m2.loadSkin(0);

							mesh = m2.meshGroup;
							this.modelRenderers.set(fileDataID, m2);
						} else if (modelMagic == constants.MAGIC.M3DT) {
							const m3 = new M3Renderer(data, renderGroup, false, false);
							await m3.load();
							await m3.loadLOD(0);

							mesh = m3.meshGroup;
							this.modelRenderers.set(fileDataID, m3);
						}
					}

					// Apply relative position/rotation/scale.
					const pos = doodad.position;
					mesh.position.set(pos[0], pos[2], pos[1] * -1);

					const rot = doodad.rotation;
					mesh.quaternion.set(rot[0], rot[2], rot[1] * -1, rot[3]);

					mesh.scale.set(doodad.scale, doodad.scale, doodad.scale);
				} catch (e) {
					log.write('Failed to load doodad %d (offset %d) for %s: %s', fileDataID, doodad.offset, set.name, e.message);
					console.log(e);
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
	 * Update the wireframe state for all active materials.
	 */
	updateWireframe() {
		const renderWireframe = core.view.config.modelViewerWireframe;
		const materials = this.getRenderMaterials(this.renderGroup, new Set());

		for (const material of materials) {
			material.wireframe = renderWireframe;
			material.needsUpdate = true;
		}
	}

	/**
	 * Recursively collect render materials.
	 * @param {object} root 
	 * @param {Set} out 
	 * @returns 
	 */
	getRenderMaterials(root, out) {
		if (root.children) {
			for (const child of root.children)
				this.getRenderMaterials(child, out);
		}
		
		if (root.material) {
			for (const material of root.material)
				out.add(material);
		}
		return out;
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
		for (const renderer of this.modelRenderers.values())
			renderer.dispose();

		// Remove M2 clones from the renderGroup.
		for (const clone of this.m2Clones)
			this.renderGroup.remove(clone);

		// Remove doodad set containers from renderGroup.
		// In theory, these should now be empty is M2 renderers dispose correctly.
		if (Array.isArray(this.doodadSets)) {
			for (const set of this.doodadSets)
				this.renderGroup.remove(set);
		}

		// Dereference M2 renderers for faster clean-up.
		this.modelRenderers = undefined;
		this.m2Clones = undefined;

		// Unregister reactive watchers.
		this.groupWatcher?.();
		this.setWatcher?.();
		this.wireframeWatcher?.();

		// Empty reactive arrays.
		if (this.groupArray) this.groupArray.splice(0);
		if (this.setArray) this.setArray.splice(0);

		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();
	}
}

module.exports = WMORenderer;