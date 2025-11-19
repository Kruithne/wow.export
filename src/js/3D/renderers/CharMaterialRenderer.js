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
const PNGWriter = require('../../png-writer');

const FRAG_SHADER_SRC = path.join(constants.SHADER_PATH, 'char.fragment.shader');
const VERT_SHADER_SRC = path.join(constants.SHADER_PATH, 'char.vertex.shader');

let VERT_SHADER_TEXT = '';
let FRAG_SHADER_TEXT = '';

const UV_BUFFER_DATA = new Float32Array([
	0, 1,
	1, 1,
	0, 0,
	0, 0,
	1, 1,
	1, 0
]);

class CharMaterialRenderer {
	static async init() {
		VERT_SHADER_TEXT = await fsp.readFile(VERT_SHADER_SRC, 'utf8');
		FRAG_SHADER_TEXT = await fsp.readFile(FRAG_SHADER_SRC, 'utf8');
	}

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
	 * Get canvas.
	 */
	getCanvas() {
		return this.glCanvas;
	}

	/**
	 * Get raw pixel data from WebGL framebuffer.
	 * Returns Uint8Array of RGBA pixels, avoiding canvas alpha premultiplication.
	 */
	getRawPixels() {
		const width = this.glCanvas.width;
		const height = this.glCanvas.height;
		const pixels = new Uint8Array(width * height * 4);

		this.gl.readPixels(0, 0, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels);

		// flip y-axis since gl.readPixels returns bottom-up
		const flipped = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const src_idx = (y * width + x) * 4;
				const dst_idx = ((height - y - 1) * width + x) * 4;
				flipped[dst_idx] = pixels[src_idx];
				flipped[dst_idx + 1] = pixels[src_idx + 1];
				flipped[dst_idx + 2] = pixels[src_idx + 2];
				flipped[dst_idx + 3] = pixels[src_idx + 3];
			}
		}

		return flipped;
	}

	/**
	 * Get URI from raw pixels, avoiding canvas alpha premultiplication.
	 */
	getURI() {
		const pixels = this.getRawPixels();
		const png = new PNGWriter(this.glCanvas.width, this.glCanvas.height);
		const pixel_data = png.getPixelData();
		pixel_data.set(pixels);
		
		const buffer = png.getBuffer();
		const base64 = buffer.toBase64();
		return 'data:image/png;base64,' + base64;
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
	async setTextureTarget(chrCustomizationMaterial, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer, useAlpha = true, blpOverride = null) {

		// CharComponentTextureSection: SectionType, X, Y, Width, Height, OverlapSectionMask
		// ChrModelTextureLayer: TextureType, Layer, Flags, BlendMode, TextureSectionTypeBitMask, TextureSectionTypeBitMask2, ChrModelTextureTargetID[2]
		// ChrModelMaterial: TextureType, Width, Height, Flags, Unk
		// ChrCustomizationMaterial: ChrModelTextureTargetID, FileDataID (this is actually MaterialResourceID but we translate it before here)

		// For debug purposes
		let filename = listfile.getByID(chrCustomizationMaterial.FileDataID);
		console.log("Loading texture " + filename + " for target " + chrCustomizationMaterial.ChrModelTextureTargetID + " with alpha " + useAlpha);

		let textureID;
		if (blpOverride) {
			textureID = await this.loadTextureFromBLP(blpOverride, useAlpha);
			filename = 'baked npc texture (override)';
		} else {
			textureID = await this.loadTexture(chrCustomizationMaterial.FileDataID, useAlpha);
		}

		this.textureTargets.push({
			id: chrCustomizationMaterial.ChrModelTextureTargetID,
			section: charComponentTextureSection,
			material: chrModelMaterial,
			textureLayer: chrModelTextureLayer,
			custMaterial: chrCustomizationMaterial,
			textureID: textureID,
			filename: filename
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

		this.gl.getExtension('WEBGL_lose_context').loseContext();
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
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, blp.width, blp.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, blpData);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		return texture;
	}

	async loadTextureFromBLP(blp, useAlpha = true) {
		console.log('loadtexturefromblp called with blp:', blp, 'width:', blp.width, 'height:', blp.height);
		const texture = this.gl.createTexture();
		const blpData = blp.toUInt8Array(0, useAlpha? 0b1111 : 0b0111);
		console.log('blp data length:', blpData.length, 'expected:', blp.width * blp.height * 4);
		this.gl.activeTexture(this.gl.TEXTURE0);
		this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, blp.width, blp.height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, blpData);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT);
		this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
		console.log('texture created successfully:', texture);
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
		this.gl.shaderSource(vertShader, VERT_SHADER_TEXT);
		this.gl.compileShader(vertShader);

		if (!this.gl.getShaderParameter(vertShader, this.gl.COMPILE_STATUS)) {
			log.write('Vertex shader failed to compile: %s', this.gl.getShaderInfoLog(vertShader));
			throw new Error('Failed to compile vertex shader');
		}

		// Compile fragment shader.
		const fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
		this.gl.shaderSource(fragShader, FRAG_SHADER_TEXT);
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
		this.baseTextureLocation = this.gl.getUniformLocation(this.glShaderProg, "u_baseTexture");
		this.blendModeLocation = this.gl.getUniformLocation(this.glShaderProg, "u_blendMode");
		this.vertexPositionAttribute = this.gl.getAttribLocation(this.glShaderProg, "a_position");
	}

	/**
	 * Update 3D data.
	 */
	async update() {
		this.clearCanvas();
		
		this.gl.clearColor(0.5, 0.5, 0.5, 1);
		this.gl.disable(this.gl.DEPTH_TEST);

		// order this.textureTargets by key
		this.textureTargets.sort((a, b) => a.id - b.id);
		
		for (const layer of this.textureTargets) {
			// Hide underwear based on settings
			if (!core.view.config.chrIncludeBaseClothing && (layer.textureLayer.ChrModelTextureTargetID[0] == 13 || layer.textureLayer.ChrModelTextureTargetID[0] == 14))
				continue;

			const materialMiddleX = layer.material.Width / 2;
			const materialMiddleY = layer.material.Height / 2;

			const sectionTopLeftX = (layer.section.X - materialMiddleX) / materialMiddleX;
			const sectionTopLeftY = (layer.section.Y + layer.section.Height - materialMiddleY) / materialMiddleY * -1;
			
			const sectionBottomRightX = (layer.section.X + layer.section.Width - materialMiddleX) / materialMiddleX;
			const sectionBottomRightY = (layer.section.Y - materialMiddleY) / materialMiddleY * -1;

			console.log("[" + layer.material.TextureType + "] Placing texture " + layer.filename + " of blend mode " + layer.textureLayer.BlendMode + " for target " + layer.id + " with offset " + layer.section.X + "x" + layer.section.Y + " of size " + layer.section.Width + "x" + layer.section.Height + " at " + sectionTopLeftX + ", " + sectionTopLeftY + " to " + sectionBottomRightX + ", " + sectionBottomRightY);

			// Vertex buffer
			const vBuffer = this.gl.createBuffer();
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

			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, uvBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, UV_BUFFER_DATA, this.gl.STATIC_DRAW);

			this.gl.vertexAttribPointer(this.uvPositionAttribute, 2, this.gl.FLOAT, false, 0, 0);
			this.gl.enableVertexAttribArray(this.uvPositionAttribute);

			this.gl.uniform1i(this.textureLocation, 0); // Bind materials
			this.gl.uniform1f(this.blendModeLocation, layer.textureLayer.BlendMode); // Bind blend mode

			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, layer.textureID);

			this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
			this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

			switch (layer.textureLayer.BlendMode) {
				case 0: // None
					this.gl.disable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.ONE, this.gl.ZERO);
					break;
				case 1: // Blit
				case 4: // Multiply
				case 6: // Overlay
				case 7: // Screen
				case 15: // Infer alpha blend
					this.gl.enable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
					break;
				case 9: // Alpha Straight
					this.gl.enable(this.gl.BLEND);
					this.gl.blendFuncSeparate(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA, this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA);
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
					log.write("Warning: encountered previously unused blendmode " + layer.textureLayer.BlendMode + " during character texture baking, poke a dev");
					break;
				// These are used but we don't know if they need blending enabled -- so just turn it on anyways
				case 16: // Unknown, only used for TaunkaMale.m2, probably experimental/unused
				default:
					this.gl.enable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
					break;
			}

			if (layer.textureLayer.BlendMode == 4 || layer.textureLayer.BlendMode == 6 || layer.textureLayer.BlendMode == 7) {
				// Create new texture of current canvas
				const canvasTexture = this.gl.createTexture();
				this.gl.activeTexture(this.gl.TEXTURE1);
				this.gl.bindTexture(this.gl.TEXTURE_2D, canvasTexture)

				if (layer.material.Width == layer.section.Width && layer.material.Height == layer.section.Height) {
					// Just copy the canvas
					this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.glCanvas);
				} else {
					// Get pixels of relevant section
					const pixelBuffer = new Uint8Array(layer.section.Width * layer.section.Height * 4);
					this.gl.readPixels(layer.section.X, layer.section.Y, layer.section.Width, layer.section.Height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixelBuffer);

					// Flip pixelbuffer on its y-axis
					const flippedPixelBuffer = new Uint8Array(layer.section.Width * layer.section.Height * 4);
					for (let y = 0; y < layer.section.Height; y++) {
						for (let x = 0; x < layer.section.Width; x++) {
							const index = (y * layer.section.Width + x) * 4;
							const flippedIndex = ((layer.section.Height - y - 1) * layer.section.Width + x) * 4;
							flippedPixelBuffer[flippedIndex] = pixelBuffer[index];
							flippedPixelBuffer[flippedIndex + 1] = pixelBuffer[index + 1];
							flippedPixelBuffer[flippedIndex + 2] = pixelBuffer[index + 2];
							flippedPixelBuffer[flippedIndex + 3] = pixelBuffer[index + 3];
						}
					}

					this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, layer.section.Width, layer.section.Height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, flippedPixelBuffer);
				}
				
				this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
				this.gl.uniform1i(this.baseTextureLocation, 1);
			}

			// Draw
			this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
		}
	}
}

module.exports = CharMaterialRenderer;