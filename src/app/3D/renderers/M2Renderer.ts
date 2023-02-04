/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import * as THREE from 'three';

import BLPFile from '../../casc/blp';
import M2Loader from '../loaders/M2Loader';
import RenderCache from './RenderCache';
import TextureRibbon from '../../ui/texture-ribbon';
import Log from '../../log';
import State from '../../state';
import BufferWrapper from '../../buffer';

import getGeosetName from '../GeosetMapper';
import GeosetEntry from '../GeosetEntry';

import { CreatureDisplayInfoEntry } from '../../db/caches/DBCreatures';
import { ItemDisplayInfoEntry } from '../../db/caches/DBItemDisplays';

export type DisplayInfo = CreatureDisplayInfoEntry | ItemDisplayInfoEntry;

const DEFAULT_MODEL_COLOR = 0x57afe2;

export default class M2Renderer {
	data: BufferWrapper | undefined;
	m2: M2Loader;
	renderGroup: THREE.Group;
	reactive: boolean;
	useRibbon: boolean;
	syncID: number = -1;
	materials = Array<THREE.MeshStandardMaterial | THREE.MeshPhongMaterial>();
	renderCache = new RenderCache();
	defaultMaterial = new THREE.MeshPhongMaterial({ name: 'default', color: DEFAULT_MODEL_COLOR, side: THREE.DoubleSide });
	geosetWatcher?: () => void;
	wireframeWatcher?: () => void;
	meshGroup: THREE.Group | undefined;
	geosetArray: Array<GeosetEntry> | undefined;

	/**
	 * Construct a new M2Renderer instance.
	 * @param data - The M2 data to render.
	 * @param renderGroup - The THREE.Group to render the model into.
	 * @param reactive - Whether to react to changes in the model viewer state.
	 * @param useRibbon - Whether to use a texture ribbon for the model.
	 */
	constructor(data: BufferWrapper, renderGroup: THREE.Group, reactive: boolean = false, useRibbon: boolean = true) {
		this.data = data;
		this.renderGroup = renderGroup;
		this.reactive = reactive;
		this.useRibbon = useRibbon;
	}

	/** Load the provided model for rendering. */
	async load(): Promise<void> {
		if (this.data === undefined)
			throw new Error('M2Renderer has already discarded its data.');

		// Parse the M2 data.
		this.m2 = new M2Loader(this.data);
		this.m2.load();

		this.loadTextures();
		if (this.m2.vertices.length > 0) {
			await this.loadSkin(0);

			if (this.reactive) {
				this.geosetWatcher = State.state.$watch('modelViewerGeosets', () => this.updateGeosets(), { deep: true });
				this.wireframeWatcher = State.state.$watch('config.modelViewerWireframe', () => this.updateWireframe(), { deep: true });
			}
		}

		// Drop reference to raw data, we don't need it now.
		this.data = undefined;
	}

	/** Update the wireframe state for all materials. */
	updateWireframe(): void {
		const renderWireframe = State.state.config.modelViewerWireframe;
		for (const material of this.materials) {
			material.wireframe = renderWireframe;
			material.needsUpdate = true;
		}
	}

	/** Update the current state of geosets. */
	updateGeosets(): void {
		if (!this.reactive || !this.meshGroup || !this.geosetArray)
			return;

		const meshes = this.meshGroup.children;
		for (let i = 0, n = meshes.length; i < n; i++)
			meshes[i].visible = this.geosetArray[i].checked;
	}

	/**
	 * Load a skin with a given index.
	 * @param index - The index of the skin to load.
	 */
	async loadSkin(index: number): Promise<void> {
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
			geometry.addGroup(skinMesh.triangleStart, skinMesh.triangleCount, texUnit ? m2.textureCombos[texUnit.textureComboIndex] : undefined);

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));

			if (this.reactive) {
				const isDefault = (skinMesh.submeshID === 0 || skinMesh.submeshID.toString().endsWith('01'));
				const geosets = this.geosetArray as Array<GeosetEntry>;
				geosets[i] = { label: 'Geoset ' + i, checked: isDefault, id: skinMesh.submeshID };
			}
		}

		if (this.reactive) {
			const geosets = State.modelViewerGeosets = this.geosetArray as Array<GeosetEntry>;
			geosets.map((geoset: GeosetEntry, i: number) => {
				geoset.label = getGeosetName(i, geoset.id);
			});
		}

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);

		// Update geosets once (so defaults are applied correctly).
		this.updateGeosets();
	}

	/**
	 * Apply replaceable textures to this model.
	 * @param {Array} display
	 */
	async applyReplaceableTextures(display: DisplayInfo): Promise<void> {
		for (let i = 0, n = this.m2.textureTypes.length; i < n; i++) {
			const textureType = this.m2.textureTypes[i];
			if (textureType >= 11 && textureType < 14) {
				// Creature textures.
				this.overrideTextureType(textureType, display.textures[textureType - 11]);
			} else if (textureType > 1 && textureType < 5) {
				// Item textures.
				this.overrideTextureType(textureType, display.textures[textureType - 2]);
			}
		}
	}

	/**
	 *
	 * @param {number} type
	 * @param {number} fileDataID
	 */
	async overrideTextureType(type: number, fileDataID: number): Promise<void> {
		const textureTypes = this.m2.textureTypes;
		const renderWireframe = State.state.config.modelViewerWireframe;

		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] !== type)
				continue;

			const tex = new THREE.Texture();
			const loader = new THREE.ImageLoader();

			const data = await State.state.casc.getFile(fileDataID);
			const blp = new BLPFile(data);
			const blpURI = blp.getDataURL(0b0111);

			if (this.useRibbon) {
				TextureRibbon.setSlotFile(i, fileDataID, this.syncID);
				TextureRibbon.setSlotSrc(i, blpURI, this.syncID);
			}

			loader.load(blpURI, image => {
				tex.image = image;
				tex.format = THREE.RGBAFormat;
				tex.needsUpdate = true;
			});

			this.renderCache.retire(this.materials[i]);

			const material = new THREE.MeshPhongMaterial({
				name: fileDataID.toString(),
				map: tex,
				side: THREE.DoubleSide,
				wireframe: renderWireframe
			});

			this.renderCache.register(material, tex);

			this.materials[i] = material;
			this.renderCache.addUser(material);
		}
	}

	/**
	 * Load all textures needed for the M2 model.
	 */
	loadTextures(): void {
		const textures = this.m2.textures;

		this.renderCache.retire(...this.materials);
		this.materials = new Array(textures.length);

		if (this.useRibbon)
			this.syncID = TextureRibbon.reset();

		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];

			const ribbonSlot = this.useRibbon ? TextureRibbon.addSlot() : null;

			if (texture.fileDataID > 0) {
				const tex = new THREE.Texture();
				const loader = new THREE.ImageLoader();

				if (ribbonSlot !== null)
					TextureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					const blpURI = blp.getDataURL(0b0111);

					if (ribbonSlot !== null)
						TextureRibbon.setSlotSrc(ribbonSlot, blpURI, this.syncID);

					loader.load(blpURI, image => {
						tex.image = image;
						tex.format = THREE.RGBAFormat;
						tex.needsUpdate = true;
					});
				}).catch(e => {
					Log.write('Failed to side-load texture %d for 3D preview: %s', texture.fileDataID, e.message);
				});

				if (texture.flags & 0x1)
					tex.wrapS = THREE.RepeatWrapping;

				if (texture.flags & 0x2)
					tex.wrapT = THREE.RepeatWrapping;

				const material = new THREE.MeshPhongMaterial({
					name: texture.fileDataID.toString(),
					map: tex,
					side: THREE.DoubleSide
				});

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
	disposeMeshGroup(): void {
		// Clear out geoset controller.
		if (this.geosetArray)
			this.geosetArray.splice(0);

		if (this.meshGroup) {
			// Remove this mesh group from the render group.
			this.renderGroup.remove(this.meshGroup);

			// Dispose of all children.
			for (const child of this.meshGroup.children as Array<THREE.Mesh>)
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
	dispose(): void {
		// Unregister reactive watchers.
		this.geosetWatcher?.();
		this.wireframeWatcher?.();

		this.renderCache.retire(...this.materials);

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;