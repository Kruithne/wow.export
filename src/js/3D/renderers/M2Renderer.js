/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../../core');
const log = require('../../log');

const BufferWrapper = require('../../buffer');
const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const GeosetMapper = require('../GeosetMapper');
const dbLogic = require('../../db/DBLogic');

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

			if (this.reactive)
				this.geosetWatcher = core.view.$watch('modelViewerGeosets', () => this.updateGeosets(), { deep: true });
		}

		// Drop reference to raw data, we don't need it now.
		this.data = undefined;
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
				const isDefault = (skinMesh.submeshID == 0 || skinMesh.submeshID.toString().endsWith('01'));
				this.geosetArray[i] = { label: 'Geoset ' + i, checked: isDefault, id: skinMesh.submeshID };
			}
		}

		if (this.reactive) {
			core.view.modelViewerGeosets = this.geosetArray;
			GeosetMapper.map(this.geosetArray);
		}

		// Add mesh group to the render group.
		this.renderGroup.add(this.meshGroup);

		// Update geosets once (so defaults are applied correctly)
		this.updateGeosets();
	}

	/**
	 * Load an NPC variant texture onto this model.
	 * @param {number} fileDataID 
	 */
	async loadNPCVariantTexture(fileDataID) {
		try {
			log.write('Loading variant texture %d', fileDataID);
			if (!this.defaultMaterial)
				throw new Error('Model does not have a default material to replace.');

			const data = await core.view.casc.getFile(fileDataID);
			const blp = new BLPFile(data);

			const loader = new THREE.ImageLoader();
			loader.load(blp.getDataURL(false), image => {
				const tex = new THREE.Texture();
				const mat = this.defaultMaterial;

				tex.image = image;
				tex.format = THREE.RGBAFormat;
				tex.needsUpdate = true;

				mat.map = tex;
				mat.color = 0x0;
				mat.needsUpdate = true;
			});
		} catch (e) {
			log.write('Failed to set variant texture: %s', e.message);
		}
	}

	async overrideTextureType(type, fileDataID) {
		const textureTypes = this.m2.textureTypes;
		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] != type)
				continue;
			
			let tex = this.textures[i];
			if (tex === undefined)
				tex = this.textures[i] = new THREE.Texture();

			const loader = new THREE.ImageLoader();

			const data = await core.view.casc.getFile(fileDataID);
			const blp = new BLPFile(data);
			loader.load(blp.getDataURL(false), image => {
				tex.image = image;
				tex.format = THREE.RGBAFormat;
				tex.needsUpdate = true;
			});

			// TODO: Flags from one of the DB2s?
			/*// if (texture.flags & 0x1)
				// tex.wrapS = THREE.RepeatWrapping;

			// if (texture.flags & 0x2)
				// tex.wrapT = THREE.RepeatWrapping;*/
			this.materials[i] = new THREE.MeshPhongMaterial({ name: fileDataID, map: tex });
		}
	}

	async applyCharacterCustomizationChoice(choiceID) {
		// Get target geoset ID
		const targetGeosetID = dbLogic.getGeosetForChoice(choiceID);

		// Get other choices for this option 
		const otherChoices = dbLogic.getChoicesByOption(core.view.modelViewerSelectedChrCustCategory[0].id);

		let otherGeosets = new Array();
		if (otherChoices.length > 0) {
			for (const otherChoice of otherChoices) {
				const otherGeosetID = dbLogic.getGeosetForChoice(otherChoice.id);
				if (otherGeosetID)
					otherGeosets.push(otherGeosetID);
			}
		}

		if (targetGeosetID) {
			let currGeosets = core.view.modelViewerGeosets;
			for (let i = 0; i < currGeosets.length; i++) {
				if (currGeosets[i].id == targetGeosetID) {
					currGeosets[i].checked = true;
					console.log('Checking ' + currGeosets[i].id);
				} else {
					// Check if current geoset is checked and part of another choice in the current option, disable if so.
					if (currGeosets[i].checked && otherGeosets.includes(currGeosets[i].id)) {
						console.log('Un-checking ' + currGeosets[i].id);
						currGeosets[i].checked = false;
					}
				}
			}
		}

		const textureForChoice = dbLogic.getTextureForFileDataIDAndChoice(core.view.modelViewerCurrFileDataID, choiceID);
		if (textureForChoice) {
			if (textureForChoice.TextureType == 1 && textureForChoice.TextureSectionTypeBitMask == -1) {
				// TODO: Skin texture!
				// This requires generating a texture based on several textures from ChrModelTextureLayer.
				// Type 1 & TextureSectionTypeBitMask == -1 & Layer = 0 is the base layer, every other type 1 is laid on top of the base texture based on values.
				// To do this, go from TextureSectionTypeBitMask => CharComponentTextureSections.SectionType based on the correct ChrComponentTextureLayoutID
				// let skinMats = Array();
				// skinMats[0] = { fileDataID: 1027767 };
				// skinMats[1] = { position: new THREE.Vector2(256, 192), fileDataID: 1027743 };
				const skinMats = dbLogic.getSkinMaterialsForChoice(core.view.modelViewerCurrFileDataID, choiceID);
				this.buildSkinMaterial(skinMats);
			} else {
				console.log('Overriding texture slot ' + textureForChoice.TextureType + ' with ' + textureForChoice.FileDataID);
				this.overrideTextureType(textureForChoice.TextureType, textureForChoice.FileDataID);
			}
		}
	}

	/**
	 * TODO: Build skin material based on several FileDataIDs at specific X/Y offsets.
	 * Base material should be in [0] with all the other textures in layers on top of that.
	 */
	async buildSkinMaterial(skinMats) {
		console.log('Building skin material', skinMats);
		const mergedTexture = await this.mergeSkinMaterials(skinMats);
		var texture = new THREE.Texture();

		const loader = new THREE.ImageLoader();
		loader.load(mergedTexture, image => {
			texture.image = image; // TODO: Should we update once after drawing all or after every draw? Hmmmmm
			texture.format = THREE.RGBAFormat;
			texture.needsUpdate = true;
			texture.generateMipmaps = true;
		});

		const textureTypes = this.m2.textureTypes;
		console.log(textureTypes);
		for (let i = 0, n = textureTypes.length; i < n; i++) {
			// Don't mess with textures not for this type.
			if (textureTypes[i] != 1)
				continue;

			this.materials[i] = new THREE.MeshPhongMaterial({ name: 'compiledSkinTexture', map: texture });
		}
	}

	/**
	 * Merges different skin materials
	 */
	async mergeSkinMaterials(skinMats) {
		const debugCanvas = document.createElement('canvas');
		const gl = debugCanvas.getContext('webgl');
		debugCanvas.width = skinMats[0].size.x;
		debugCanvas.height = skinMats[0].size.y;

		const vertCode = 'attribute vec4 a_position;\n' +
		'attribute vec2 a_texcoord;\n' + 
		'varying vec2 v_texcoord;\n' +
		'void main() {\n' +
		'gl_Position = a_position;' +
		'v_texcoord = a_texcoord;' +
		'}';

		const vertShader = gl.createShader(gl.VERTEX_SHADER);
		gl.shaderSource(vertShader, vertCode);
		gl.compileShader(vertShader);

		var message = gl.getShaderInfoLog(vertShader);
		if (message.length > 0)
			console.log(message);

		const fragCode = 'precision mediump float;\n'+
		'varying vec2 v_texcoord;' +
		'uniform sampler2D u_texture;' +
		'void main() {'+
		'gl_FragColor = texture2D(u_texture, v_texcoord);' +
		'}';

		const fragShader = gl.createShader(gl.FRAGMENT_SHADER);

		gl.shaderSource(fragShader, fragCode);
		gl.compileShader(fragShader);

		var fragMessage = gl.getShaderInfoLog(fragShader);
		if (fragMessage.length > 0)
			console.log(fragMessage);

		const shaderProgram = gl.createProgram();
		gl.attachShader(shaderProgram, vertShader);
		gl.attachShader(shaderProgram, fragShader);
		gl.linkProgram(shaderProgram);
		gl.validateProgram(shaderProgram);

		if ( !gl.getProgramParameter( shaderProgram, gl.LINK_STATUS) ) {
			var info = gl.getProgramInfoLog(shaderProgram);
			throw 'Could not compile WebGL program. \n\n' + info;
		}

		gl.useProgram(shaderProgram);

		const positionLocation = gl.getAttribLocation(shaderProgram, 'a_position');
		const texcoordLocation = gl.getAttribLocation(shaderProgram, 'a_texcoord');
		const textureLocation = gl.getUniformLocation(shaderProgram, 'u_texture');

		// Create a buffer.
		var positionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

		// GL position space goes from -1.0 to 1.0
		var positions = [
			-1.0,  -1.0,
			1.0,  -1.0,
			-1.0,  1.0,
			-1.0,  1.0,
			1.0,  -1.0,
			1.0,  1.0,
		];
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

		var texcoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);

		var texcoords = [
			0.0,  1.0,
			1.0,  1.0,
			0.0,  0.0,
			0.0,  0.0,
			1.0,  1.0,
			1.0,  0.0,
		];
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texcoords), gl.STATIC_DRAW);

		var tex = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);

		const blp = new BLPFile(await core.view.casc.getFile(skinMats[0].FileDataID));
		const blpData = blp.toUInt8Array(0);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, skinMats[0].size.x, skinMats[0].size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, blpData);

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		gl.viewport(0, 0, skinMats[0].size.x, skinMats[0].size.y);

		gl.clear(gl.COLOR_BUFFER_BIT);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);

		gl.useProgram(shaderProgram);

		gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
		gl.enableVertexAttribArray(positionLocation);
		gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
		gl.enableVertexAttribArray(texcoordLocation);
		gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 0, 0);

		gl.uniform1i(textureLocation, 0);

		gl.drawArrays(gl.TRIANGLES, 0, 6);

		gl.enable(gl.BLEND);
		
		for (let i = 1; i < skinMats.length; i++) {
			if (!(i in skinMats))
				continue;

			// Only overlay skin textures
			if (skinMats[i].TextureType != 1)
				continue;

			const overlayBLP = new BLPFile(await core.view.casc.getFile(skinMats[i].FileDataID));
			const overlayBLPData = overlayBLP.toUInt8Array(0);
			
			const emptyTextureData = new Uint8Array(skinMats[0].size.x * skinMats[0].size.y * 4);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, skinMats[0].size.x, skinMats[0].size.y, 0, gl.RGBA, gl.UNSIGNED_BYTE, emptyTextureData);
			gl.texSubImage2D(gl.TEXTURE_2D, 0, skinMats[i].position.x, skinMats[i].position.y, skinMats[i].size.x, skinMats[i].size.y, gl.RGBA, gl.UNSIGNED_BYTE, overlayBLPData);

			// Do blending magic
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

			// Draw another time
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		}

		gl.deleteBuffer(positionBuffer);
		gl.deleteBuffer(texcoordBuffer);

		return debugCanvas.toDataURL();
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
					loader.load(blp.getDataURL(false), image => {
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
				this.materials[i] = new THREE.MeshPhongMaterial({ name: texture.fileDataID, map: tex });
			} else {
				if (!this.defaultMaterial)
					this.defaultMaterial = new THREE.MeshPhongMaterial({ name: 'default', color: DEFAULT_MODEL_COLOR });

				this.materials[i] = this.defaultMaterial;
			}
		}
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
		// Unregister geoset array watcher.
		if (this.geosetWatcher)
			this.geosetWatcher();

		// Release bound textures.
		for (const tex of this.textures)
			tex?.dispose();

		this.disposeMeshGroup();
	}
}

module.exports = M2Renderer;