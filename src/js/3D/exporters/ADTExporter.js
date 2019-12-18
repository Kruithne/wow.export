const util = require('util');
const core = require('../../core');
const path = require('path');
const fsp = require('fs').promises;
const constants = require('../../constants');
const listfile = require('../../casc/listfile');
const log = require('../../log');

const BufferWrapper = require('../../buffer');
const BLPFile = require('../../casc/blp');

const WDTLoader = require('../loaders/WDTLoader');
const ADTLoader = require('../loaders/ADTLoader');

const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');

const MAP_SIZE = constants.GAME.MAP_SIZE;
const TILE_SIZE = constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const wdtCache = new Map();

const FRAG_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.fragment.shader');
const VERT_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.vertex.shader');

let glShaderProg;
let glCanvas;
let gl;

/**
 * Load a texture from CASC and bind it to the GL context.
 * @param {number} fileDataID 
 */
const loadTexture = async (fileDataID) => {
	const texture = gl.createTexture();
	const blp = new BLPFile(await core.view.casc.getFile(fileDataID));

	gl.bindTexture(gl.TEXTURE_2D, texture);

	// For unknown reasons, we have to store blpData as a variable. Inlining it into the
	// parameter list causes issues, despite it being syncronous.
	const blpData = blp.toUInt8Array(0);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blp.scaledWidth, blp.scaledHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, blpData);
	gl.generateMipmap(gl.TEXTURE_2D);

	return texture;
};

/**
 * Bind an alpha layer to the GL context.
 * @param {Array} layer 
 */
const bindAlphaLayer = (layer) => {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);

	const data = new Uint8Array(layer.length * 4);
	for (let i = 0, j = 0, n = layer.length; i < n; i++, j += 4)
		data[j + 0] = data[j + 1] = data[j + 2] = data[j + 3] = layer[i];

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.generateMipmap(gl.TEXTURE_2D);

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
 * Save the current canvas state to a file.
 * @param {string} dir 
 * @param {string} file 
 */
const saveCanvas = async (dir, file) => {
	// This is a quick and easy fix to rotate tiles to their correct orientation.
	const rotate = document.createElement('canvas');
	rotate.width = glCanvas.width;
	rotate.height = glCanvas.height;

	const ctx = rotate.getContext('2d');
	ctx.translate(rotate.width / 2, rotate.height / 2);
	ctx.rotate(Math.PI / 180 * 180);
	ctx.drawImage(glCanvas, -(rotate.width / 2), -(rotate.height / 2));

	const buf = await BufferWrapper.fromCanvas(rotate, 'image/png');
	await buf.writeToFile(path.join(dir, file));
};

/**
 * Compile the vertex and fragment shaders used for baking.
 * Will be attached to the current GL context.
 */
const compileShaders = async () => {
	glShaderProg = gl.createProgram();

	// Compile fragment shader.
	const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
	gl.shaderSource(fragShader, await fsp.readFile(FRAG_SHADER_SRC, 'utf8'));
	gl.compileShader(fragShader);

	if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
		log.write('Fragment shader failed to compile: %s', gl.getShaderInfoLog(fragShader));
		throw new Error('Failed to compile fragment shader');
	}

	// Compile vertex shader.
	const vertShader = gl.createShader(gl.VERTEX_SHADER);
	gl.shaderSource(vertShader, await fsp.readFile(VERT_SHADER_SRC, 'utf8'));
	gl.compileShader(vertShader);

	if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
		log.write('Vertex shader failed to compile: %s', gl.getShaderInfoLog(vertShader));
		throw new Error('Failed to compile vertex shader');
	}

	// Attach shaders.
	gl.attachShader(glShaderProg, fragShader);
	gl.attachShader(glShaderProg, vertShader);

	// Link program.
	gl.linkProgram(glShaderProg);	
	if (!gl.getProgramParameter(glShaderProg, gl.LINK_STATUS)) {
		log.write('Unable to link shader program: %s', gl.getProgramInfoLog(glShaderProg));
		throw new Error('Failed to link shader program');
	}

	gl.useProgram(glShaderProg);
};

class ADTExporter {
	/**
	 * Construct a new ADTLoader instance.
	 * @param {number} mapID 
	 * @param {string} mapDir 
	 * @param {number} tileIndex 
	 */
	constructor(mapID, mapDir, tileIndex) {
		this.mapID = mapID;
		this.mapDir = mapDir;
		this.tileX = tileIndex % MAP_SIZE;
		this.tileY = Math.floor(tileIndex / MAP_SIZE);
		this.tileID = this.tileY + '_' + this.tileX;
		this.tileIndex = tileIndex;
	}

	/**
	 * Export the ADT tile.
	 * @param {string} dir Directory to export the tile into.
	 * @param {number} textureRes
	 */
	async export(dir, quality) {
		const casc = core.view.casc;
		const prefix = util.format('world/maps/%s/%s', this.mapDir, this.mapDir);

		// Load the WDT. We cache this to speed up exporting large amounts of tiles
		// from the same map. Make sure ADTLoader.clearCache() is called after exporting.
		let wdt = wdtCache.get(this.mapDir);
		if (!wdt) {
			wdt = new WDTLoader(await casc.getFileByName(prefix + '.wdt'));
			await wdt.load();
			wdtCache.set(this.mapDir, wdt);
		}

		console.log(wdt);
		const tilePrefix = prefix + '_' + this.tileID;

		const maid = wdt.entries[this.tileIndex];
		const rootFileDataID = maid.rootADT > 0 ? maid.rootADT : listfile.getByFilename(tilePrefix + '.adt');
		const tex0FileDataID = maid.tex0ADT > 0 ? maid.tex0ADT : listfile.getByFilename(tilePrefix + '_obj0.adt');
		const obj0FileDataID = maid.obj0ADT > 0 ? maid.obj0ADT : listfile.getByFilename(tilePrefix + '_tex0.adt');

		// Ensure we actually have the fileDataIDs for the files we need.
		if (rootFileDataID === 0 || tex0FileDataID === 0 || obj0FileDataID === 0)
			throw new Error('Missing fileDataID for ADT files: ' + [rootFileDataID, tex0FileDataID, obj0FileDataID].join(', '));

		const rootAdt = new ADTLoader(await casc.getFile(rootFileDataID));
		rootAdt.loadRoot();

		const texAdt = new ADTLoader(await casc.getFile(tex0FileDataID));
		texAdt.loadTex(wdt);

		const objAdt = new ADTLoader(await casc.getFile(obj0FileDataID));
		objAdt.loadObj();

		const verticies = new Array(16 * 16 * 145 * 3);
		const normals = new Array(16 * 16 * 145 * 3);
		const uvs = new Array(16 * 16 * 145 * 2);
		const vertexColors = new Array(16 * 16 * 145 * 4);

		const chunkMeshes = new Array(256);

		const obj = new OBJWriter(path.join(dir, 'adt_' + this.tileID + '.obj'));
		const mtl = new MTLWriter(path.join(dir, 'adt_' + this.tileID + '.mtl'));

		const firstChunk = rootAdt.chunks[0];
		const firstChunkX = firstChunk.position[0];
		const firstChunkY = firstChunk.position[1];

		const splitTextures = quality >= 8192;
	
		let ofs = 0;
		let chunkID = 0;
		for (let x = 0, midx = 0; x < 16; x++) {
			for (let y = 0; y < 16; y++) {
				const indicies = [];

				const chunkIndex = (x * 16) + y;
				const chunk = rootAdt.chunks[chunkIndex];

				const chunkX = chunk.position[0];
				const chunkY = chunk.position[1];
				const chunkZ = chunk.position[2];

				for (let row = 0, idx = 0; row < 17; row++) {
					const isShort = !!(row % 2);
					const colCount = isShort ? 8 : 9;

					for (let col = 0; col < colCount; col++) {
						let vx = chunkY - (col * UNIT_SIZE);
						let vy = chunk.verticies[idx] + chunkZ;
						let vz = chunkX - (row * UNIT_SIZE_HALF);

						if (isShort)
							vx -= UNIT_SIZE_HALF;

						const vIndex = midx * 3;
						verticies[vIndex + 0] = vx;
						verticies[vIndex + 1] = vy;
						verticies[vIndex + 2] = vz;

						const normal = chunk.normals[idx];
						normals[vIndex + 0] = normal[0] / 127;
						normals[vIndex + 1] = normal[1] / 127;
						normals[vIndex + 2] = normal[2] / 127;

						const cIndex = midx * 4;
						if (chunk.vertexShading) {
							// Store vertex shading in BGRA format.
							const color = chunk.vertexShading[idx];
							vertexColors[cIndex + 0] = color.b / 255;
							vertexColors[cIndex + 1] = color.g / 255;
							vertexColors[cIndex + 2] = color.r / 255;
							vertexColors[cIndex + 3] = color.a / 255;
						} else {
							// No vertex shading, default to this.
							vertexColors[cIndex + 0] = 0.5;
							vertexColors[cIndex + 1] = 0.5;
							vertexColors[cIndex + 2] = 0.5;
							vertexColors[cIndex + 3] = 1;
						}

						const uvIdx = isShort ? col + 0.5 : col;
						const uvIndex = midx * 2;

						if (quality === 0) {
							uvs[uvIndex + 0] = uvIdx / 8;
							uvs[uvIndex + 1] = (row * 0.5) / 8;
						} else if (splitTextures) {
							uvs[uvIndex + 0] = col / 8;
							uvs[uvIndex + 1] = 1 - (row / 16);
						} else {
							uvs[uvIndex + 0] = -(vx - firstChunkX) / TILE_SIZE;
							uvs[uvIndex + 1] = (vz - firstChunkY) / TILE_SIZE;
						}

						idx++;
						midx++;
					}
				}

				const holesHighRes = chunk.holesHighRes;
				for (let j = 9, xx = 0, yy = 0; j < 145; j++, xx++) {
					if (xx >= 8) {
						xx = 0;
						yy++;
					}

					let isHole = true;
					if (!(chunk.flags & 0x10000)) {
						const current = Math.pow(2, Math.floor(xx / 2) + Math.floor(yy / 4));

						if (!(chunk.holesLowRes & current))
							isHole = false;
					} else {
						if (!((holesHighRes[yy] >> xx) & 1))
							isHole = false;
					}

					if (!isHole) {
						const indOfs = ofs + j;
						indicies.push(indOfs + 8, indOfs - 9, indOfs);
						indicies.push(indOfs - 9, indOfs - 8, indOfs);
						indicies.push(indOfs - 8, indOfs + 9, indOfs);
						indicies.push(indOfs + 9, indOfs + 8, indOfs);
					}

					if (!((j + 1) % (9 + 8)))
						j += 9;
				}
			
				ofs = midx;

				if (splitTextures)
					mtl.addMaterial(chunkID, 'tex_' + this.tileID + '_' + chunkID + '.png');

				obj.addMesh(chunkID++, indicies, splitTextures ? chunkID : 'terrain');
				chunkMeshes[chunkIndex] = indicies;
			}
		}

		if (!splitTextures)
			mtl.addMaterial('terrain', 'tex_' + this.tileID + '.png');

		obj.setVertArray(verticies);
		obj.setNormalArray(normals);
		obj.setUVArray(uvs);

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));
		
		await obj.write();
		await mtl.write();

		if (quality <= 512) {
			// Use minimaps for cheap textures.
			const tilePath = util.format('world/minimaps/%s/map%d_%d.blp', this.mapDir, this.tileY, this.tileX);
			const data = await casc.getFileByName(tilePath, false, true);
			const blp = new BLPFile(data);

			// Draw the BLP onto a raw-sized canvas.
			const canvas = blp.toCanvas(false);

			// Scale the image down by copying the raw canvas onto a
			// scaled canvas, and then returning the scaled image data.
			const scale = quality / blp.scaledWidth;
			const scaled = document.createElement('canvas');
			scaled.width = quality;
			scaled.height = quality;

			const ctx = scaled.getContext('2d');
			ctx.scale(scale, scale);
			ctx.drawImage(canvas, 0, 0);

			const buf = await BufferWrapper.fromCanvas(scaled, 'image/png');
			await buf.writeToFile(path.join(dir, 'tex_' + this.tileID + '.png'));
		} else {
			// Create new GL context and compile shaders.
			if (!gl) {
				glCanvas = document.createElement('canvas');
				gl = glCanvas.getContext('webgl');

				await compileShaders();
			}

			// Materials
			const materialIDs = texAdt.diffuseTextureFileDataIDs;
			const heightIDs = texAdt.heightTextureFileDataIDs;
			const texParams = texAdt.texParams;

			const materials = new Array(materialIDs.length);
			for (let i = 0, n = materials.length; i < n; i++) {
				const diffuseFileDataID = materialIDs[i];
				const heightFileDataID = heightIDs[i];

				const mat = materials[i] = { scale: 1, heightScale: 0, heightOffset: 1 };
				mat.diffuseTex = await loadTexture(diffuseFileDataID);

				if (texParams && texParams[i]) {
					const params = texParams[i];
					mat.scale = Math.pow(2, (params.flags & 0xF0) >> 4);

					if (params.height !== 0 || params.offset !== 1) {
						mat.heightScale = params.height;
						mat.heightOffset = params.offset;
						mat.heightTex = heightFileDataID ? await loadTexture(heightFileDataID) : mat.diffuseTex;
					}
				}
			}

			const aVertexPosition = gl.getAttribLocation(glShaderProg, 'aVertexPosition');
			const aTexCoord = gl.getAttribLocation(glShaderProg, 'aTextureCoord');
			const aVertexColor = gl.getAttribLocation(glShaderProg, 'aVertexColor');

			const uLayers = new Array(4);
			const uScales = new Array(4);
			const uHeights = new Array(4);
			const uBlends = new Array(4);

			for (let i = 0; i < 4; i++) {
				uLayers[i] = gl.getUniformLocation(glShaderProg, 'pt_layer' + i);
				uScales[i] = gl.getUniformLocation(glShaderProg, 'layerScale' + i);
				uHeights[i] = gl.getUniformLocation(glShaderProg, 'pt_height' + i);

				if (i > 0)
					uBlends[i] = gl.getUniformLocation(glShaderProg, 'pt_blend' + i);
			}

			const uHeightScale = gl.getUniformLocation(glShaderProg, 'pc_heightScale');
			const uHeightOffset = gl.getUniformLocation(glShaderProg, 'pc_heightOffset');
			const uTranslation = gl.getUniformLocation(glShaderProg, 'uTranslation');
			const uResolution = gl.getUniformLocation(glShaderProg, 'uResolution');

			if (splitTextures) {
				// Bake texture split over chunks.
				glCanvas.width = quality / 16;
				glCanvas.height = quality / 16;

				let chunkID = 0;
				for (let x = 0; x < 16; x++) {
					for (let y = 0; y < 16; y++) {
						clearCanvas();

						const vertexBuffer = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
							-1, 1, 1, 1, 1, -1,
							-1, 1, 1, -1, -1, -1
						]), gl.STATIC_DRAW);

						gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

						gl.enableVertexAttribArray(aVertexPosition);
						gl.vertexAttribPointer(aVertexPosition, 2, gl.FLOAT, false, 0, 0);

						gl.drawArrays(gl.TRIANGLES, 0, 6);

						unbindAllTextures();
						await saveCanvas(dir, 'tex_' + this.tileID + '_' + (chunkID++) + '.png');
					}
				}
			} else {
				// Bake full texture.
				glCanvas.width = quality;
				glCanvas.height = quality;

				clearCanvas();

				gl.uniform2f(uResolution, TILE_SIZE, TILE_SIZE);

				const vertexBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verticies), gl.STATIC_DRAW);
				gl.enableVertexAttribArray(aVertexPosition);
				gl.vertexAttribPointer(aVertexPosition, 3, gl.FLOAT, false, 0, 0);

				const uvBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
				gl.enableVertexAttribArray(aTexCoord);
				gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);

				const vcBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, vcBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexColors), gl.STATIC_DRAW);
				gl.enableVertexAttribArray(aVertexColor);
				gl.vertexAttribPointer(aVertexColor, 4, gl.FLOAT, false, 0, 0);

				const firstChunk = rootAdt.chunks[0];
				const deltaX = firstChunk.position[1] - TILE_SIZE;
				const deltaY = firstChunk.position[0] - TILE_SIZE;
				gl.uniform2f(uTranslation, -deltaX, -deltaY);

				for (let x = 0; x < 16; x++) {
					for (let y = 0; y < 16; y++) {
						const chunkIndex = (x * 16) + y;
						const texChunk = texAdt.texChunks[chunkIndex];
						const indicies = chunkMeshes[chunkIndex];

						const alphaLayers = texChunk.alphaLayers || [];
						const alphaTextures = new Array(alphaLayers.length);

						for (let i = 1; i < alphaLayers.length; i++) {
							gl.activeTexture(gl.TEXTURE3 + i);

							const alphaTex = bindAlphaLayer(alphaLayers[i]);
							gl.bindTexture(gl.TEXTURE_2D, alphaTex);
							gl.uniform1i(uBlends[i], i + 3);

							// Store to clean up after render.
							alphaTextures[i] = alphaTex;
						}

						const texLayers = texChunk.layers;
						const heightScales = new Array(4).fill(1);
						const heightOffsets = new Array(4).fill(1);

						for (let i = 0, n = texLayers.length; i < n; i++) {
							const mat = materials[texLayers[i].textureId];							
							gl.activeTexture(gl.TEXTURE0 + i);
							gl.bindTexture(gl.TEXTURE_2D, mat.diffuseTex);

							gl.uniform1i(uLayers[i], i);
							gl.uniform1f(uScales[i], mat.scale);

							if (mat.heightTex) {
								gl.activeTexture(gl.TEXTURE7 + i);
								gl.bindTexture(gl.TEXTURE_2D, mat.heightTex);

								gl.uniform1i(uHeights[i], 7 + i);
								heightScales[i] = mat.heightScale;
								heightOffsets[i] = mat.heightOffset;
							}
						}

						gl.uniform4f(uHeightScale, ...heightScales);
						gl.uniform4f(uHeightOffset, ...heightOffsets);

						const indexBuffer = gl.createBuffer();
						gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
						gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indicies), gl.STATIC_DRAW);
						gl.drawElements(gl.TRIANGLES, indicies.length, gl.UNSIGNED_SHORT, 0);

						unbindAllTextures();
						
						// Destroy alpha layers rendered for the tile.
						for (const tex of alphaTextures)
							gl.deleteTexture(tex);
					}
				}

				await saveCanvas(dir, 'tex_' + this.tileID + '.png');
			}

			// Clear buffer.
			gl.bindBuffer(gl.ARRAY_BUFFER, null);

			// Delete loaded textures.
			for (const mat of materials)
				gl.deleteTexture(mat.texture);
		}
	}

	/**
	 * Clear internal tile-loading cache.
	 */
	static clearCache() {
		wdtCache.clear();
	}
}

module.exports = ADTExporter;