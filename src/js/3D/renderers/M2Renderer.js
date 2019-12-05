const BLPFile = require('../../casc/blp');
const Texture = require('../Texture');
const M2Loader = require('../loaders/M2Loader');

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
		}
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

		for (let i = 0, n = skin.submeshes.length; i < n; i++) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', dataVerts);
			geometry.setAttribute('normal', dataNorms);
			geometry.setAttribute('uv', dataUVs);
			geometry.setIndex(skin.triangles);

			const skinMesh = skin.submeshes[i];
			const texUnit = skin.textureUnits.find(tex => tex.skinSectionIndex === i);
			geometry.addGroup(skinMesh.triangleStart, skinMesh.triangleCount, m2.textureCombos[texUnit.textureComboIndex]);

			this.meshGroup.add(new THREE.Mesh(geometry, this.materials));
		}

		// Adjust for weird WoW rotations?
		this.meshGroup.rotateOnAxis(new THREE.Vector3(1, 0, 0), 270 * (Math.PI / 180));
		this.meshGroup.rotateOnAxis(new THREE.Vector3(0, 0, 1), 270 * (Math.PI / 180));

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

				if (texture.flags & Texture.FLAG_WRAP_U)
					tex.wrapS = THREE.RepeatWrapping;

				if (texture.flags & Texture.FLAG_WRAP_V)
					tex.wrapT = THREE.RepeatWrapping;

				this.textures.push(tex);
				this.materials[i] = new THREE.MeshPhongMaterial({ map: tex });
			} else {
				this.materials[i] = DEFAULT_MATERIAL;
			}
		}
	}

	/**
	 * Dispose of all meshes controlled by this renderer.
	 */
	disposeMeshGroup() {
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
		// Release bound textures.
		for (const tex of this.textures)
			tex.dispose();

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;