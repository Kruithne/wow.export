/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import util from 'node:util';

import * as THREE from 'three';

import Listfile from '../../casc/listfile';
import State from '../../state';
import Log from '../../log';
import BufferWrapper from '../../buffer';

import WMOLoader from '../loaders/WMOLoader';
import M2Renderer from './M2Renderer';
import Texture from '../Texture';
import BLPImage from '../../casc/blp';

import textureRibbon from '../../ui/texture-ribbon';

const DEFAULT_MATERIAL = new THREE.MeshPhongMaterial({ color: 0x57afe2, side: THREE.DoubleSide });

type WMORenderMaterial = THREE.Material | THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;

type WMOSet = {
	label: string,
	index: number,
	checked: boolean
};

export default class WMORenderer {
	wmo: WMOLoader;
	data: BufferWrapper | undefined;
	fileID: number | string;
	meshGroup: THREE.Group | undefined;
	renderGroup: THREE.Group;
	syncID: number;
	m2Renderers: Map<number, M2Renderer> = new Map();
	textures = new Array<THREE.DataTexture>();
	m2Clones = new Array<THREE.Group>();
	groupArray: Array<WMOSet> | undefined;
	materials = new Array<WMORenderMaterial>();
	setArray: Array<WMOSet> | undefined;
	doodadSets: Array<THREE.Group> | undefined;

	groupWatcher: () => void | undefined;
	setWatcher: () => void | undefined;
	wireframeWatcher: () => void | undefined;

	/**
	 * Construct a new WMORenderer instance.
	 * @param data
	 * @param fileID
	 * @param renderGroup
	 */
	constructor(data: BufferWrapper, fileID: number | string, renderGroup: THREE.Group) {
		this.data = data;
		this.fileID = fileID;
		this.renderGroup = renderGroup;
		this.m2Renderers = new Map();
	}

	/**
	 * Load the provided model for rendering.
	 */
	async load(): Promise<void> {
		if (this.data === undefined)
			throw new Error('WMORenderer has already discarded its data');

		// Parse the WMO data.
		const wmo = this.wmo = new WMOLoader(this.data, this.fileID, true);
		await wmo.load();
		this.loadTextures();

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
			this.groupArray.push({ label: wmo.groupNames[group.nameOfs], checked: true, index: i });
		}

		const setCount = wmo.doodadSets.length;
		this.setArray = new Array<WMOSet>(setCount);
		this.doodadSets = new Array<THREE.Group>(setCount);

		for (let i = 0; i < setCount; i++)
			this.setArray[i] = { label: wmo.doodadSets[i].name, index: i, checked: false };

		// Set-up reactive controls.
		State.modelViewerWMOGroups = this.groupArray;
		State.modelViewerWMOSets = this.setArray;
		this.groupWatcher = State.$watch('modelViewerWMOGroups', () => this.updateGroups(), { deep: true });
		this.setWatcher = State.$watch('modelViewerWMOSets', () => this.updateSets(), { deep: true });
		this.wireframeWatcher = State.$watch('config.modelViewerWireframe', () => this.updateWireframe(), { deep: true });

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
	loadTextures(): void {
		const wmo = this.wmo;
		const materialCount = wmo.materials.length;
		const materials = this.materials = new Array<WMORenderMaterial>(materialCount);

		this.syncID = textureRibbon.reset();

		const isClassic = !!wmo.textureNames;
		for (let i = 0; i < materialCount; i++) {
			const material = wmo.materials[i];
			const texture = new Texture(material.flags);

			if (isClassic) {
				texture.setFileName(wmo.textureNames[material.texture1]);
			} else {
				if (material.shader == 23)
					texture.fileDataID = material.texture2;
				else
					texture.fileDataID = material.texture1;
			}

			if (texture.fileDataID > 0) {
				materials[i] = DEFAULT_MATERIAL;
				const ribbonSlot = textureRibbon.addSlot();
				textureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				texture.getTextureFile().then(data => {
					const blp = new BLPImage(data);
					const blpURI = blp.getDataURL(0b0111);

					textureRibbon.setSlotSrc(ribbonSlot, blpURI, this.syncID);

					const tex = new THREE.DataTexture(blp.toUInt8Array(), blp.width, blp.height, THREE.RGBAFormat);
					tex.needsUpdate = true;

					if (!(texture.flags & 0x40))
						tex.wrapS = THREE.RepeatWrapping;

					if (!(texture.flags & 0x80))
						tex.wrapT = THREE.RepeatWrapping;

					this.textures.push(tex);
					materials[i] = new THREE.MeshPhongMaterial({ map: tex, side: THREE.DoubleSide });
				}).catch(e => {
					Log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
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
	 * @param textureID
	 * @param wmo
	 */
	async loadAuxiliaryTextureForRibbon(textureID: number, wmo: WMOLoader): Promise<void> {
		if (wmo.textureNames)
			textureID = Listfile.getByFilename(textureID.toString()) || 0;

		if (textureID > 0) {
			const ribbonSlot = textureRibbon.addSlot();
			textureRibbon.setSlotFile(ribbonSlot, textureID, this.syncID);

			const data = await State.casc.getFile(textureID);
			const blp = new BLPImage(data);

			textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(), this.syncID);
		}
	}

	/**
	 * Load a doodad set for this WMO.
	 * @param index
	 */
	async loadDoodadSet(index: number): Promise<void> {
		const wmo = this.wmo;
		const set = wmo.doodadSets[index];
		const casc = State.casc;

		if (!set)
			throw new Error(util.format('Invalid doodad set requested: %s', index));

		Log.write('Loading doodad set: %s', set.name);

		const renderGroup = new THREE.Group();

		const firstIndex = set.firstInstanceIndex;
		const count = set.doodadCount;

		State.isBusy++;
		State.setToast('progress', util.format('Loading doodad set %s (%d doodads)...', set.name, count), null, -1, false);

		for (let i = 0; i < count; i++) {
			const doodad = wmo.doodads[firstIndex + i];
			let fileDataID = 0;

			if (wmo.fileDataIDs)
				fileDataID = wmo.fileDataIDs[doodad.offset];
			else
				fileDataID = Listfile.getByFilename(wmo.doodadNames[doodad.offset]) || 0;

			if (fileDataID > 0) {
				try {
					let mesh: THREE.Group | undefined;
					const m2Renderer = this.m2Renderers.get(fileDataID);
					if (m2Renderer !== undefined) {
						const meshGroup = m2Renderer.meshGroup;
						if (meshGroup === undefined)
							throw new Error('M2Renderer lacks meshGroup');

						mesh = meshGroup.clone(true);
						renderGroup.add(mesh);
						this.m2Clones.push(mesh);
					} else {
						// New M2, load it from CASC and prepare for render.
						const data = await casc.getFile(fileDataID);
						const m2 = new M2Renderer(data, renderGroup, false, false);

						await m2.load();
						await m2.loadSkin(0);

						mesh = m2.meshGroup;

						this.m2Renderers.set(fileDataID, m2);
					}

					if (mesh !== undefined) {
						// Apply relative position/rotation/scale.
						const pos = doodad.position;
						mesh.position.set(pos[0], pos[2], pos[1] * -1);

						const rot = doodad.rotation;
						mesh.quaternion.set(rot[0], rot[2], rot[1] * -1, rot[3]);

						mesh.scale.set(doodad.scale, doodad.scale, doodad.scale);
					}
				} catch (e) {
					Log.write('Failed to load doodad %d for %s: %s', fileDataID, set.name, e.message);
				}
			}
		}

		this.renderGroup.add(renderGroup);

		if (this.doodadSets !== undefined)
			this.doodadSets[index] = renderGroup;

		State.hideToast();
		State.isBusy--;
	}

	/**
	 * Update the visibility status of WMO groups.
	 */
	updateGroups(): void {
		if (!this.meshGroup || !this.groupArray)
			return;

		const meshes = this.meshGroup.children;
		for (let i = 0, n = meshes.length; i < n; i++)
			meshes[i].visible = this.groupArray[i].checked;
	}

	/**
	 * Update the wireframe state for all active materials.
	 */
	updateWireframe(): void {
		const renderWireframe = State.config.modelViewerWireframe;
		const materials = this.getRenderMaterials(this.renderGroup, new Set());

		for (const material of materials) {
			if (material instanceof THREE.MeshStandardMaterial)
				material.wireframe = renderWireframe;

			material.needsUpdate = true;
		}
	}

	/**
	 * Recursively collect render materials.
	 * @param root
	 * @param out
	 * @returns
	 */
	getRenderMaterials(root: THREE.Object3D, out: Set<WMORenderMaterial>): Set<WMORenderMaterial> {
		if (root instanceof THREE.Group) {
			for (const child of root.children)
				this.getRenderMaterials(child, out);
		}

		if (root instanceof THREE.Mesh) {
			if (Array.isArray(root.material)) {
				for (const material of root.material)
					out.add(material);
			} else {
				out.add(root.material);
			}
		}
		return out;
	}

	/** Update the visibility status of doodad sets. */
	async updateSets(): Promise<void> {
		if (!this.wmo || !this.setArray || !this.doodadSets)
			return;

		for (let i = 0, n = this.doodadSets.length; i < n; i++) {
			const state = this.setArray[i].checked;
			const set = this.doodadSets[i];

			if (set)
				set.visible = state;
			else if (state)
				await this.loadDoodadSet(i);
		}
	}

	/** Dispose of this instance and release all resources. */
	dispose(): void {
		if (this.meshGroup) {
			// Remove this mesh group from the render group.
			this.renderGroup.remove(this.meshGroup);

			// Dispose of all children.
			for (const child of this.meshGroup.children) {
				if (child instanceof THREE.Mesh)
					child.geometry.dispose();
			}

			// Remove all children from the group for good measure.
			this.meshGroup.remove(...this.meshGroup.children);

			// Drop the reference to the mesh group.
			this.meshGroup = undefined;
		}

		// Dispose of all M2 renderers for doodad sets.
		for (const renderer of this.m2Renderers.values())
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
		this.m2Renderers.clear();
		this.m2Clones.length = 0;

		// Unregister reactive watchers.
		this.groupWatcher?.();
		this.setWatcher?.();
		this.wireframeWatcher?.();

		// Empty reactive arrays.
		this.groupArray?.splice(0);
		this.setArray?.splice(0);

		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();
	}
}