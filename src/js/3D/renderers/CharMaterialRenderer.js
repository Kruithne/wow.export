/*!
wow.export (https://github.com/Kruithne/wow.export)
Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
License: MIT
*/
const path = require('path');
const fsp = require('fs').promises;
const BLPFile = require('../../casc/blp');
const core = require('../../core');
const log = require('../../log');
const listfile = require('../../casc/listfile');
const constants = require('../../constants');
const overlay = require('../../ui/char-texture-overlay');

const FRAG_SHADER_SRC = path.join(constants.SHADER_PATH, 'char.fragment.shader');
const VERT_SHADER_SRC = path.join(constants.SHADER_PATH, 'char.vertex.shader');

class CharMaterialRenderer {
	/**
	 * Construct a new CharMaterialRenderer instance.
	 */
	constructor(textureLayer, width, height) {
		this.textureTargets = [];

		const canvas = document.createElement('canvas');
		canvas.id = 'charMaterialCanvas-' + textureLayer;

		overlay.add(canvas);

		canvas.width = width;
		canvas.height = height;

		this.gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
		this.glCanvas = canvas;
	}

	/**
	 * Initialize the CharMaterialRenderer.
	 */
	async init() {
		await this.compileShaders();
		await this.reset();
	}

	/**
	 * Get URI from canvas.
	 */
	getURI() {
		return this.glCanvas.toDataURL();
	}

	/**
	 * Reset canvas.
	 */
	async reset() {
		this.unbindAllTextures();
		this.textureTargets = [];
		this.clearCanvas();
	}

	/**
	 * Loads a specific texture to a target.
	 */
	async setTextureTarget(chrCustomizationMaterial, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer) {

		// CharComponentTextureSection: SectionType, X, Y, Width, Height, OverlapSectionMask
		// ChrModelTextureLayer: TextureType, Layer, Flags, BlendMode, TextureSectionTypeBitMask, TextureSectionTypeBitMask2, ChrModelTextureTargetID[2]
		// ChrModelMaterial: TextureType, Width, Height, Flags, Unk
		// ChrCustomizationMaterial: ChrModelTextureTargetID, FileDataID (this is actually MaterialResourceID but we translate it before here) 

		// TODO: This requires some more effort to figure out how to properly apply. e.g. mount armor should NOT load alpha but tattoos should.
		// const useAlpha = chrCustomizationMaterial.ChrModelTextureTargetID != 16;
		const useAlpha = true;

		this.textureTargets.push({
			id: chrCustomizationMaterial.ChrModelTextureTargetID,
			section: charComponentTextureSection,
			material: chrModelMaterial,
			textureLayer: chrModelTextureLayer,
			custMaterial: chrCustomizationMaterial,
			textureID: await this.loadTexture(chrCustomizationMaterial.FileDataID, useAlpha)
		});

		await this.update();
	}

	/**
	 * Disposes of all the things
	 */
	dispose() {
		this.unbindAllTextures();

		if (this.glShaderProg) {
			this.gl.deleteProgram(this.glShaderProg);
			this.glShaderProg = null;
		}

		this.clearCanvas();
		overlay.remove(this.glCanvas);

		this.glCanvas = null;
		this.gl = null;		
	}

	/**
	 * Load a texture from CASC and bind it to the GL context.
	 * @param {number} fileDataID 
	 * @param {boolean} useAlpha
	 */
	async loadTexture(fileDataID, useAlpha = true) {
		const texture = this.gl.createTexture();
		const blp = new BLPFile(await core.view.casc.getFile(fileDataID));

		// TODO: DXT(1/3/5) support

		// For unknown reasons, we have to store blpData as a variable. Inlining it into the
		// parameter list causes issues, despite it being synchronous.
		const blpData = blp.toUInt8Array(0, useAlpha? 0b1111 : 0b0111);

		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, blp.width, blp.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, blpData);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		return texture;
	}

	/**
	 * Unbind all textures from the GL context.
	 */
	unbindAllTextures() {
		// Unbind textures.
		for (let i = 0, n = this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS); i < n; i++) {
			this.gl.activeTexture(this.gl.TEXTURE0 + i);
			this.gl.bindTexture(this.gl.TEXTURE_2D, null);
		}
	}

	/**
	 * Clear the canvas, resetting it to black.
	 */
	clearCanvas() {
		this.gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
		this.gl.clearColor(0, 0, 0, 1);
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/**
	 * Compile the vertex and fragment shaders used for baking.
	 * Will be attached to the current GL context.
	 */
	async compileShaders() {
		this.glShaderProg = this.gl.createProgram();

		// Compile vertex shader.
		const vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
		this.gl.shaderSource(vertShader, await fsp.readFile(VERT_SHADER_SRC, 'utf8'));
		this.gl.compileShader(vertShader);

		if (!this.gl.getShaderParameter(vertShader, this.gl.COMPILE_STATUS)) {
			log.write('Vertex shader failed to compile: %s', this.gl.getShaderInfoLog(vertShader));
			throw new Error('Failed to compile vertex shader');
		}

		// Compile fragment shader.
		const fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
		this.gl.shaderSource(fragShader, await fsp.readFile(FRAG_SHADER_SRC, 'utf8'));
		this.gl.compileShader(fragShader);

		if (!this.gl.getShaderParameter(fragShader, this.gl.COMPILE_STATUS)) {
			log.write('Fragment shader failed to compile: %s', this.gl.getShaderInfoLog(fragShader));
			throw new Error('Failed to compile fragment shader');
		}

		// Attach shaders.
		this.gl.attachShader(this.glShaderProg, vertShader);
		this.gl.attachShader(this.glShaderProg, fragShader);

		// Link program.
		this.gl.linkProgram(this.glShaderProg);	
		if (!this.gl.getProgramParameter(this.glShaderProg, this.gl.LINK_STATUS)) {
			log.write('Unable to link shader program: %s', this.gl.getProgramInfoLog(this.glShaderProg));
			throw new Error('Failed to link shader program');
		}

		this.gl.useProgram(this.glShaderProg);

		this.uvPositionAttribute = this.gl.getAttribLocation(this.glShaderProg, "a_texCoord");
		this.textureLocation = this.gl.getUniformLocation(this.glShaderProg, "u_texture");
		this.blendModeLocation = this.gl.getUniformLocation(this.glShaderProg, "u_blendMode");
		this.vertexPositionAttribute = this.gl.getAttribLocation(this.glShaderProg, "a_position");
	}

	/**
	 * Update 3D data.
	 */
	async update() {
		if (!this.glShaderProg)
			throw new Error('Shader program not compiled');
		
		this.clearCanvas();
		
		this.gl.clearColor(0.5, 0.5, 0.5, 1);
		this.gl.disable(this.gl.DEPTH_TEST);

		// order this.textureTargets by key
		this.textureTargets.sort((a, b) => a.id - b.id);
		
		for (const layer of this.textureTargets) {
			// Hide underwear based on settings
			if (!core.view.config.chrIncludeBaseClothing && (layer.textureLayer.ChrModelTextureTargetID[0] == 13 || layer.textureLayer.ChrModelTextureTargetID[0] == 14))
				continue;

			// Vertex buffer
			const vBuffer = this.gl.createBuffer();

			layer.material.Width; // This is the max width of the entire material. Usually 2048.
			layer.material.Height; // This is the max height of the entire material. Usually 1024.

			let sectionOffsetX = layer.section.X;
			let sectionOffsetY = layer.section.Y;
			let sectionWidth = layer.section.Width;
			let sectionHeight = layer.section.Height;

			// TODO: Investigate why hack is needed for base (smaller than section, needs stretching), armor and dracthyr textures (larger than section, needs fitting). 
			// Must be controlled through data somewhere.
			if (layer.id == 1 || layer.section.Width > layer.material.Width || layer.section.Height > layer.material.Height) {
				sectionWidth = layer.material.Width;
				sectionHeight = layer.material.Height;
				sectionOffsetX = 0;
				sectionOffsetY = 0;
			}

			const materialMiddleX = layer.material.Width / 2;
			const materialMiddleY = layer.material.Height / 2;

			const sectionTopLeftX = (sectionOffsetX - materialMiddleX) / materialMiddleX;
			const sectionTopLeftY = (sectionOffsetY + sectionHeight - materialMiddleY) / materialMiddleY * -1;
			
			const sectionBottomRightX = (sectionOffsetX + sectionWidth - materialMiddleX) / materialMiddleX;
			const sectionBottomRightY = (sectionOffsetY - materialMiddleY) / materialMiddleY * -1;

			console.log("Placing texture " + listfile.getByID(layer.custMaterial.FileDataID) + " of blend mode " + layer.textureLayer.BlendMode + " for target " + layer.id + " with offset " + sectionOffsetX + "x" + sectionOffsetY + " of size " + sectionWidth + "x" + sectionHeight + " at " + sectionTopLeftX + ", " + sectionTopLeftY + " to " + sectionBottomRightX + ", " + sectionBottomRightY);

			const vBufferData = new Float32Array([
				sectionTopLeftX, sectionTopLeftY, 0.0,
				sectionBottomRightX, sectionTopLeftY, 0.0,
				sectionTopLeftX, sectionBottomRightY, 0.0,
				sectionTopLeftX, sectionBottomRightY, 0.0,
				sectionBottomRightX, sectionTopLeftY, 0.0,
				sectionBottomRightX, sectionBottomRightY, 0.0
			]);

			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, vBufferData, this.gl.STATIC_DRAW);

			this.gl.vertexAttribPointer(this.vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.enableVertexAttribArray(this.vertexPositionAttribute);

			// TexCoord buffer
			const uvBuffer = this.gl.createBuffer();
			const uvBufferData = new Float32Array([
				0, 0, 
				1.0, 0, 
				0,  -1.0, 
				0,  -1.0, 
				1.0, 0, 
				1.0,  -1.0
			]);

			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, uvBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, uvBufferData, this.gl.STATIC_DRAW);

			this.gl.vertexAttribPointer(this.uvPositionAttribute, 2, this.gl.FLOAT, false, 0, 0);
			this.gl.enableVertexAttribArray(this.uvPositionAttribute);

			this.gl.uniform1i(this.textureLocation, 0); // Bind materials
			this.gl.uniform1f(this.blendModeLocation, layer.textureLayer.BlendMode); // Bind blend mode

			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, layer.textureID);

			switch (layer.textureLayer.BlendMode) {
				case 0: // None
					this.gl.disable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.ONE, this.gl.ZERO);
					break;
				case 1: // Blit
				case 9: // Alpha Straight
				case 15: // Infer alpha blend
					this.gl.enable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
					break;
				// The following blend modes are not used in character customization
				case 2: // Blit Alphamask 
				case 3: // Add 
				case 5: // Mod2x 
				case 8: // Hardlight
				case 10: // Blend black
				case 11: // Mask greyscale
				case 12: // Mask greyscale using color as alpha
				case 13: // Generate greyscale
				case 14: // Colorize
					console.log("Warning: encountered previously unused blendmode " + layer.textureLayer.BlendMode + ", poke a dev");
					break;
				// These are used but we don't know if they need blending enabled -- so just turn it on anyways
				case 4: // Multiply
				case 6: // Overlay
				case 7: // Screen
				case 16: // Unknown
				default:
					console.log("Warning: unimplemented blend mode " + layer.textureLayer.BlendMode + ", enabling alpha blending anyway");
					this.gl.enable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
					break;
			}

			// Draw
			this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
		}
	}
}

module.exports = CharMaterialRenderer;