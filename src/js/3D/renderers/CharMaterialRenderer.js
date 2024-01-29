/*!
wow.export (https://github.com/Kruithne/wow.export)
Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
License: MIT
*/
const BLPFile = require('../../casc/blp');
const core = require('../../core');
const log = require('../../log');

class CharMaterialRenderer {
	/**
	 * Construct a new CharMaterialRenderer instance.
	 */
	constructor(textureLayer, width, height) {
		this.textureTargets = new Map();

		this.glCanvas = document.getElementById('charMaterialCanvas-' + textureLayer);
		if (this.glCanvas == null) {
			this.glCanvas = document.createElement('canvas');
			this.glCanvas.id = 'charMaterialCanvas-' + textureLayer;
		}

		this.glCanvas.width = width;
		this.glCanvas.height = height;

		this.gl = this.glCanvas.getContext('webgl', {preserveDrawingBuffer: true});

		this.compileShaders();

		this.Reset();
	}

	/**
	 * Get URI from canvas.
	 */
	GetURI() {
		return this.glCanvas.toDataURL();
	}

	/**
	 * Reset canvas.
	 */
	async Reset() {

		this.unbindAllTextures();

		this.textureTargets = new Map();
		
		this.clearCanvas();
		await this.Update();
	}

	/**
	 * Loads a specific texture to a target.
	 */
	async SetTextureTarget(chrCustomizationMaterial, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer) {

		// CharComponentTextureSection: SectionType, X, Y, Width, Height, OverlapSectionMask
		// ChrModelTextureLayer: TextureType, Layer, Flags, BlendMode, TextureSectionTypeBitMask, TextureSectionTypeBitMask2, ChrModelTextureTargetID[2]
		// ChrModelMaterial: TextureType, Width, Height, Flags, Unk
		// ChrCustomizationMaterial: ChrModelTextureTargetID, FileDataID (this is actually MaterialResourceID but we translate it before here) 

		const textureTarget = [];
		textureTarget.section = charComponentTextureSection;
		textureTarget.material = chrModelMaterial;
		textureTarget.textureLayer = chrModelTextureLayer;
		textureTarget.textureID = await this.loadTexture(chrCustomizationMaterial.FileDataID);

		this.textureTargets.set(chrCustomizationMaterial.ChrModelTextureTargetID, textureTarget);
		await this.Update();
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

		this.glCanvas.remove();
		this.gl = null;
	}

	/**
	 * Load a texture from CASC and bind it to the GL context.
	 * @param {number} fileDataID 
	 */
	async loadTexture(fileDataID) {
		const texture = this.gl.createTexture();
		const blp = new BLPFile(await core.view.casc.getFile(fileDataID));


		// TODO: DXT(1/3/5) support

		// For unknown reasons, we have to store blpData as a variable. Inlining it into the
		// parameter list causes issues, despite it being synchronous.
		const blpData = blp.toUInt8Array(0);

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
		const vertShaderSource = `attribute vec4 a_position;
	attribute vec2 a_texCoord;

	varying vec2 v_texCoord;

	void main() {
		gl_Position = a_position;
		v_texCoord = a_texCoord;
	}`;
		const vertShader = this.gl.createShader(this.gl.VERTEX_SHADER);
		this.gl.shaderSource(vertShader, vertShaderSource);
		this.gl.compileShader(vertShader);

		if (!this.gl.getShaderParameter(vertShader, this.gl.COMPILE_STATUS)) {
			log.write('Vertex shader failed to compile: %s', this.gl.getShaderInfoLog(vertShader));
			throw new Error('Failed to compile vertex shader');
		}

		// Compile fragment shader.
		const fragShaderSource = `precision mediump float;
	varying vec2 v_texCoord;
	uniform sampler2D u_texture;

	void main() {
		gl_FragColor = texture2D(u_texture, v_texCoord);
	}`;

		const fragShader = this.gl.createShader(this.gl.FRAGMENT_SHADER);
		this.gl.shaderSource(fragShader, await fragShaderSource);
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
	}

	/**
	 * Update 3D data.
	 */
	Update() {
		this.clearCanvas();

		this.gl.useProgram(this.glShaderProg);
		
		this.gl.clearColor(0.5, 0.5, 0.5, 1);
		this.gl.disable(this.gl.DEPTH_TEST);

		// order this.textureTargets by key
		this.textureTargets = new Map([...this.textureTargets.entries()].sort((a, b) => a[0] - b[0]));
		
		for (const textureTargetEntry of this.textureTargets) {
			const textureTarget = textureTargetEntry[0];
			const layer = textureTargetEntry[1];

			// Vertex buffer
			const vBuffer = this.gl.createBuffer();

			layer.material.Width; // This is the max width of the entire material. Usually 2048.
			layer.material.Height; // This is the max height of the entire material. Usually 1024.

			const sectionOffsetX = layer.section.X;
			const sectionOffsetY = layer.section.Y;
			let sectionWidth = layer.section.Width;
			let sectionHeight = layer.section.Height;

			// TODO: Investigate why hack is needed
			if (textureTarget == 1) {
				sectionWidth = layer.material.Width;
				sectionHeight = layer.material.Height;
			}

			// TODO: Hardcoded to 2048/1024, feels like it should be layer.material.Width/Height but that doesn't work
			const materialMiddleX = layer.material.Width / 2;
			const materialMiddleY = layer.material.Height / 2;

			const sectionTopLeftX = (sectionOffsetX - materialMiddleX) / materialMiddleX;
			const sectionTopLeftY = (sectionOffsetY - materialMiddleY) / materialMiddleY;
			
			const sectionBottomRightX = (sectionOffsetX + sectionWidth - materialMiddleX) / materialMiddleX;
			const sectionBottomRightY = (sectionOffsetY + sectionHeight - materialMiddleY) / materialMiddleY;

			// console.log("Placing texture for target " + textureTarget + " with offset " + sectionOffsetX + "x" + sectionOffsetY + " of size " + sectionWidth + "x" + sectionHeight + " at " + sectionTopLeftX + ", " + sectionTopLeftY + " to " + sectionBottomRightX + ", " + sectionBottomRightY);

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

			var vertexPositionAttribute = this.gl.getAttribLocation(this.glShaderProg, "a_position");
			this.gl.vertexAttribPointer(vertexPositionAttribute, 3, this.gl.FLOAT, false, 0, 0);
			this.gl.enableVertexAttribArray(vertexPositionAttribute);

			// TexCoord buffer
			const uvBuffer = this.gl.createBuffer();
			const uvBufferData = new Float32Array([ 
				0, 0, 
				1.0, 0, 
				0,  -1.0, 
				0,  -1.0, 
				1.0, 0, 
				1.0,  -1.0]);
			this.gl.bindBuffer(this.gl.ARRAY_BUFFER, uvBuffer);
			this.gl.bufferData(this.gl.ARRAY_BUFFER, uvBufferData, this.gl.STATIC_DRAW);

			var uvPositionAttribute = this.gl.getAttribLocation(this.glShaderProg, "a_texCoord");
			this.gl.vertexAttribPointer(uvPositionAttribute, 2, this.gl.FLOAT, false, 0, 0);
			this.gl.enableVertexAttribArray(uvPositionAttribute);

			// Bind materials
			var textureLocation = this.gl.getUniformLocation(this.glShaderProg, "u_texture");
			this.gl.uniform1i(textureLocation, 0);

			this.gl.activeTexture(this.gl.TEXTURE0);
			this.gl.bindTexture(this.gl.TEXTURE_2D, layer.textureID);

			switch (layer.textureLayer.BlendMode) {
				case 0: // None
					this.gl.disable(this.gl.BLEND);
					this.gl.blendFunc(this.gl.ONE, this.gl.ZERO);
					break;
				case 1: // Blit
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