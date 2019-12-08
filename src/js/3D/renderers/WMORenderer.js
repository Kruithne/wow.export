const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const Texture = require('../Texture');
const WMOLoader = require('../loaders/WMOLoader');

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
			geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(group.verticies), 3));
			geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(group.normals), 3));

			if (group.uvs)
				geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(group.uvs[0]), 2));

			geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(group.indicies), 1));

			// Load all render batches into the mesh.
			for (const batch of group.renderBatches)
				geometry.addGroup(batch.firstFace, batch.numFaces, batch.materialID);

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
			this.groupArray.push({ label: wmo.groupNames[group.nameOfs], checked: true });
		}

		// Set-up reactive controls.
		core.view.modelViewerWMOGroups = this.groupArray;
		this.groupWatcher = core.view.$watch('modelViewerWMOGroups', () => this.updateGroups(), { deep: true });

		// Rotate to face camera.
		this.meshGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

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

		// Remove the group watcher.
		if (this.groupWatcher)
			this.groupWatcher();

		// Clear out WMO group array.
		if (this.groupArray)
			this.groupArray.splice(0, this.groupArray.length);

		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();

		this.disposeMeshGroup();
	}
}

module.exports = WMORenderer;