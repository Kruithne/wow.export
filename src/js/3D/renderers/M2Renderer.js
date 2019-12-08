const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const GeosetMapper = require('../GeosetMapper');

const DEFAULT_MATERIAL = new THREE.MeshPhongMaterial({ color: 0x57afe2 });

class M2Renderer {
	/**
	 * Construct a new M2Renderer instance.
	 * @param {BufferWrapper} data 
	 * @param {THREE.Group} renderGroup
	 */
	constructor(data, renderGroup) {
		this.data = data;
		this.renderGroup = renderGroup;
		this.textures = [];
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

			this.geosetWatcher = core.view.$watch('modelViewerGeosets', () => this.updateGeosets(), { deep: true });
		}

		// Drop reference to raw data, we don't need it now.
		this.data = undefined;
	}

	/**
	 * Update the current state of geosets.
	 */
	updateGeosets() {
		if (!this.meshGroup || !this.geosetArray)
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

		this.geosetArray = new Array(skin.submeshes.length);

		for (let i = 0, n = skin.submeshes.length; i < n; i++) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', dataVerts);
			geometry.setAttribute('normal', dataNorms);
			geometry.setAttribute('uv', dataUVs);

			// Map triangle array to indicies.
			const index = new Array(skin.triangles.length);
			for (let j = 0, m = index.length; j < m; j++)
				index[j] = skin.indicies[skin.triangles[j]];

			geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(index), 1));

			const skinMesh = skin.submeshes[i];
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === i);
			geometry.addGroup(skinMesh.triangleStart, skinMesh.triangleCount, m2.textureCombos[texUnit.textureComboIndex]);

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
			this.geosetArray[i] = { label: 'Geoset ' + i, checked: true, id: skinMesh.submeshID };
		}

		core.view.modelViewerGeosets = this.geosetArray;
		GeosetMapper.map(this.geosetArray);

		// Rotate to face camera.
		this.meshGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);
	}

	/**
	 * Load all textures needed for the M2 model.
	 */
	loadTextures() {
		const textures = this.m2.textures;
		this.materials = new Array(textures.length);
		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];

			if (texture.fileDataID > 0) {
				const tex = new THREE.Texture();
				const loader = new THREE.ImageLoader();

				texture.getTextureFile().then(data => {
					const blp = new BLPFile(data);
					loader.load(blp.getDataURL(), image => {
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

				this.textures.push(tex);
				this.materials[i] = new THREE.MeshPhongMaterial({ map: tex, alphaTest: 0.5 });
			} else {
				this.materials[i] = DEFAULT_MATERIAL;
			}
		}
	}

	/**
	 * Dispose of all meshes controlled by this renderer.
	 */
	disposeMeshGroup() {
		// Clear out geoset controller.
		if (this.geosetArray)
			this.geosetArray.splice(0, this.geosetArray.length);

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
	}

	/**
	 * Dispose of this instance and release all resources.
	 */
	dispose() {
		// Unregister geoset array watcher.
		if (this.geosetWatcher)
			this.geosetWatcher();

		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;