/*!
wow.export (https://github.com/Kruithne/wow.export)
Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
License: MIT
*/
const path = require('path');
const constants = require('../../constants');
const BLPFile = require('../../casc/blp');
const core = require('../../core');
const fsp = require('fs').promises;
const log = require('../../log');

let glShaderProg;
let glCanvas;
let gl;

const FRAG_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.fragment.shader');
const VERT_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.vertex.shader');

/**
 * Load a texture from CASC and bind it to the GL context.
 * @param {number} fileDataID 
 */
const loadTexture = async (fileDataID) => {
	const texture = gl.createTexture();
	const blp = new BLPFile(await core.view.casc.getFile(fileDataID));


	// TODO: DXT(1/3/5) support

	// For unknown reasons, we have to store blpData as a variable. Inlining it into the
	// parameter list causes issues, despite it being synchronous.
	const blpData = blp.toUInt8Array(0);

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blp.width, blp.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, blpData);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	return texture;
};

/**
 * Unbind all textures from the GL context.
 */
const unbindAllTextures = () => {
	// Unbind textures.
	for (let i = 0, n = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS); i < n; i++) {
		gl.activeTexture(gl.TEXTURE0 + i);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
};

/**
 * Clear the canvas, resetting it to black.
 */
const clearCanvas = () => {
	gl.viewport(0, 0, glCanvas.width, glCanvas.height);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
};

/**
 * Compile the vertex and fragment shaders used for baking.
 * Will be attached to the current GL context.
 */
const compileShaders = async () => {
	glShaderProg = gl.createProgram();

	// Compile vertex shader.
	const vertShaderSource = `attribute vec4 a_position;
attribute vec2 a_texCoord;

varying vec2 v_texCoord;

void main() {
	gl_Position = a_position;
	v_texCoord = a_texCoord;
}`;
	const vertShader = gl.createShader(gl.VERTEX_SHADER);
	gl.shaderSource(vertShader, vertShaderSource);
	gl.compileShader(vertShader);

	if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
		log.write('Vertex shader failed to compile: %s', gl.getShaderInfoLog(vertShader));
		throw new Error('Failed to compile vertex shader');
	}

	// Compile fragment shader.
	const fragShaderSource = `precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

void main() {
	gl_FragColor = texture2D(u_texture, v_texCoord);
}`;

	const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
	gl.shaderSource(fragShader, await fragShaderSource);
	gl.compileShader(fragShader);

	if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
		log.write('Fragment shader failed to compile: %s', gl.getShaderInfoLog(fragShader));
		throw new Error('Failed to compile fragment shader');
	}

	// Attach shaders.
	gl.attachShader(glShaderProg, vertShader);
	gl.attachShader(glShaderProg, fragShader);

	// Link program.
	gl.linkProgram(glShaderProg);	
	if (!gl.getProgramParameter(glShaderProg, gl.LINK_STATUS)) {
		log.write('Unable to link shader program: %s', gl.getProgramInfoLog(glShaderProg));
		throw new Error('Failed to link shader program');
	}

	gl.useProgram(glShaderProg);
};

class CharTextureRenderer {
	/**
	 * Construct a new CharTextureRenderer instance.
	 */
	constructor() {
		this.textureTargets = new Map();
		
	}

	/**
	 * Get URI from canvas.
	 */
	GetURI() {
		return glCanvas.toDataURL();
	}

	/**
	 * Reset canvas.
	 */
	async Reset() {
		if (!gl) {
			glCanvas = document.getElementById('texturePreview');
			gl = glCanvas.getContext('webgl', {preserveDrawingBuffer: true});

			await compileShaders();
		}

		unbindAllTextures();

		this.textureTargets = new Map();
		
		clearCanvas();
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
		textureTarget.textureID = await loadTexture(chrCustomizationMaterial.FileDataID);

		console.log(textureTarget);

		this.textureTargets.set(chrCustomizationMaterial.ChrModelTextureTargetID, textureTarget);
		await this.Update();
	}

	/**
	 * Update 3D data.
	 */
	Update() {
		// TODO: Only draw each frame, do all the buffer updates and such in a separate function
		//requestAnimationFrame(() => this.Update());

		clearCanvas();

		gl.useProgram(glShaderProg);
		
		// order this.textureTargets by key
		this.textureTargets = new Map([...this.textureTargets.entries()].sort((a, b) => a[0] - b[0]));
		
		for (const textureTargetEntry of this.textureTargets) {
			const textureTarget = textureTargetEntry[0];
			const layer = textureTargetEntry[1];

			// Vertex buffer
			const vBuffer = gl.createBuffer();

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
			const materialMiddleX = 2048 / 2;
			const materialMiddleY = 1024 / 2;

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

			gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, vBufferData, gl.STATIC_DRAW);

			var vertexPositionAttribute = gl.getAttribLocation(glShaderProg, "a_position");
			gl.vertexAttribPointer(vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(vertexPositionAttribute);

			// TexCoord buffer
			const uvBuffer = gl.createBuffer();
			const uvBufferData = new Float32Array([ 
				0, 0, 
				1.0, 0, 
				0,  -1.0, 
				0,  -1.0, 
				1.0, 0, 
				1.0,  -1.0]);
			gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, uvBufferData, gl.STATIC_DRAW);

			var uvPositionAttribute = gl.getAttribLocation(glShaderProg, "a_texCoord");
			gl.vertexAttribPointer(uvPositionAttribute, 2, gl.FLOAT, false, 0, 0);
			gl.enableVertexAttribArray(uvPositionAttribute);

			// Bind materials
			var textureLocation = gl.getUniformLocation(glShaderProg, "u_texture");
			gl.uniform1i(textureLocation, 0);

			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, layer.textureID);

			// Draw
			gl.drawArrays(gl.TRIANGLES, 0, 6);
		}
	}
}

module.exports = CharTextureRenderer;