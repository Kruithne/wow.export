/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../../core');
const path = require('path');
const fsp = require('fs').promises;
const constants = require('../../constants');
const generics = require('../../generics');
const listfile = require('../../casc/listfile');
const log = require('../../log');

const BufferWrapper = require('../../buffer');
const BLPFile = require('../../casc/blp');

const WDTLoader = require('../loaders/WDTLoader');
const ADTLoader = require('../loaders/ADTLoader');

const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');

const WDCReader = require('../../db/WDCReader');

const ExportHelper = require('../../casc/export-helper');
const M2Exporter = require('../../3D/exporters/M2Exporter');
const WMOExporter = require('../../3D/exporters/WMOExporter');
const CSVWriter = require('../../3D/writers/CSVWriter');
const JSONWriter = require('../../3D/writers/JSONWriter');

const MAP_SIZE = constants.GAME.MAP_SIZE;
const TILE_SIZE = constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const wdtCache = new Map();

const FRAG_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.fragment.shader');
const FRAG_SHADER_OLD_SRC = path.join(constants.SHADER_PATH, 'adt.fragment.old.shader');
const VERT_SHADER_SRC = path.join(constants.SHADER_PATH, 'adt.vertex.shader');

let isFoliageAvailable = false;
let hasLoadedFoliage = false;
let dbTextures;
let dbDoodads;

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
	// parameter list causes issues, despite it being synchronous.
	const blpData = blp.toUInt8Array(0);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blp.scaledWidth, blp.scaledHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, blpData);
	gl.generateMipmap(gl.TEXTURE_2D);

	return texture;
};

/**
 * Load and cache GroundEffectDoodad and GroundEffectTexture data tables.
 */
const loadFoliageTables = async () => {
	if (!hasLoadedFoliage) {
		try {
			dbDoodads = new WDCReader('DBFilesClient/GroundEffectDoodad.db2',);
			dbTextures = new WDCReader('DBFilesClient/GroundEffectTexture.db2');

			await dbDoodads.parse();
			await dbTextures.parse();

			hasLoadedFoliage = true;
			isFoliageAvailable = true;
		} catch (e) {
			isFoliageAvailable = false;
			log.write('Unable to load foliage tables, foliage exporting will be unavailable for all tiles.');
		}

		hasLoadedFoliage = true;
	}
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
 * Convert an RGBA object into an integer.
 * @param {object} rgba 
 * @returns {number}
 */
const rgbaToInt = (rgba) => {
	let intval = rgba.r;
	intval = (intval << 8) + rgba.g;
	intval = (intval << 8) + rgba.b;
	return (intval << 8) + rgba.a;
};

/**
 * Compile the vertex and fragment shaders used for baking.
 * Will be attached to the current GL context.
 */
const compileShaders = async (useOld = false) => {
	glShaderProg = gl.createProgram();

	// Compile fragment shader.
	const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
	gl.shaderSource(fragShader, await fsp.readFile(useOld ? FRAG_SHADER_OLD_SRC : FRAG_SHADER_SRC, 'utf8'));
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
	 * @param {Set|undefined} gameObjects Additional game objects to export.
	 * @param {ExportHelper} helper
	 * @returns {string}
	 */
	async export(dir, quality, gameObjects, helper) {
		const casc = core.view.casc;
		const config = core.view.config;

		const out = { type: config.mapsExportRaw ? 'ADT_RAW' : 'ADT_OBJ', path: '' };

		const usePosix = config.pathFormat === 'posix';
		const prefix = util.format('world/maps/%s/%s', this.mapDir, this.mapDir);

		// Load the WDT. We cache this to speed up exporting large amounts of tiles
		// from the same map. Make sure ADTLoader.clearCache() is called after exporting.
		let wdt = wdtCache.get(this.mapDir);
		if (!wdt) {
			const wdtFile = await casc.getFileByName(prefix + '.wdt');

			wdt = new WDTLoader(wdtFile);
			await wdt.load();
			wdtCache.set(this.mapDir, wdt);

			if (config.mapsExportRaw) {
				await wdtFile.writeToFile(path.join(dir, this.mapDir + '.wdt'));
				
				if (wdt.lgtFileDataID > 0) {
					const lgtFile = await casc.getFile(wdt.lgtFileDataID);
					lgtFile.writeToFile(path.join(dir, this.mapDir + '_lgt.wdt'));
				}

				if (wdt.occFileDataID > 0) {
					const occFile = await casc.getFile(wdt.occFileDataID);
					occFile.writeToFile(path.join(dir, this.mapDir + '_occ.wdt'));
				}

				if (wdt.fogsFileDataID > 0) {
					const fogsFile = await casc.getFile(wdt.fogsFileDataID);
					fogsFile.writeToFile(path.join(dir, this.mapDir + '_fogs.wdt'));
				}

				if (wdt.mpvFileDataID > 0) {
					const mpvFile = await casc.getFile(wdt.mpvFileDataID);
					mpvFile.writeToFile(path.join(dir, this.mapDir + '_mpv.wdt'));
				}

				if (wdt.texFileDataID > 0) {
					const texFile = await casc.getFile(wdt.texFileDataID);
					texFile.writeToFile(path.join(dir, this.mapDir + '.tex'));
				}

				if (wdt.wdlFileDataID > 0) {
					const wdlFile = await casc.getFile(wdt.wdlFileDataID);
					wdlFile.writeToFile(path.join(dir, this.mapDir + '.wdl'));
				}

				if (wdt.pd4FileDataID > 0) {
					const pd4File = await casc.getFile(wdt.pd4FileDataID);
					pd4File.writeToFile(path.join(dir, this.mapDir + '.pd4'));
				}
			}
		}

		console.log(wdt);
		const tilePrefix = prefix + '_' + this.tileID;

		const maid = wdt.entries[this.tileIndex];
		const rootFileDataID = maid.rootADT > 0 ? maid.rootADT : listfile.getByFilename(tilePrefix + '.adt');
		const tex0FileDataID = maid.tex0ADT > 0 ? maid.tex0ADT : listfile.getByFilename(tilePrefix + '_tex0.adt');
		const obj0FileDataID = maid.obj0ADT > 0 ? maid.obj0ADT : listfile.getByFilename(tilePrefix + '_obj0.adt');
		const obj1FileDataID = maid.obj1ADT > 0 ? maid.obj1ADT : listfile.getByFilename(tilePrefix + '_obj1.adt');

		// Ensure we actually have the fileDataIDs for the files we need. LOD is not available on Classic.
		if (rootFileDataID === 0 || tex0FileDataID === 0 || obj0FileDataID === 0 || obj1FileDataID === 0)
			throw new Error('Missing fileDataID for ADT files: ' + [rootFileDataID, tex0FileDataID, obj0FileDataID].join(', '));

		const rootFile = await casc.getFile(rootFileDataID);
		const texFile = await casc.getFile(tex0FileDataID);
		const objFile = await casc.getFile(obj0FileDataID);

		if (config.mapsExportRaw) {
			await rootFile.writeToFile(path.join(dir, this.mapDir + "_" + this.tileID + '.adt'));
			await texFile.writeToFile(path.join(dir, this.mapDir + "_" + this.tileID + '_tex0.adt'));
			await objFile.writeToFile(path.join(dir, this.mapDir + "_" + this.tileID + '_obj0.adt'));

			// We only care about these when exporting raw files.
			const obj1File = await casc.getFile(obj1FileDataID);
			await obj1File.writeToFile(path.join(dir, this.mapDir + "_" + this.tileID + '_obj1.adt'));

			// LOD is not available on Classic.
			if (maid.lodADT > 0) {
				const lodFile = await casc.getFile(maid.lodADT);
				await lodFile.writeToFile(path.join(dir, this.mapDir + "_" + this.tileID + '_lod.adt'));
			}		
		}

		const rootAdt = new ADTLoader(rootFile);
		rootAdt.loadRoot();

		const texAdt = new ADTLoader(texFile);
		texAdt.loadTex(wdt);

		const objAdt = new ADTLoader(objFile);
		objAdt.loadObj();

		if (!config.mapsExportRaw) {
			const vertices = new Array(16 * 16 * 145 * 3);
			const normals = new Array(16 * 16 * 145 * 3);
			const uvs = new Array(16 * 16 * 145 * 2);
			const uvsBake = new Array(16 * 16 * 145 * 2);
			const vertexColors = new Array(16 * 16 * 145 * 4);

			const chunkMeshes = new Array(256);

			const objOut = path.join(dir, 'adt_' + this.tileID + '.obj');
			out.path = objOut;

			const obj = new OBJWriter(objOut);
			const mtl = new MTLWriter(path.join(dir, 'adt_' + this.tileID + '.mtl'));

			const firstChunk = rootAdt.chunks[0];
			const firstChunkX = firstChunk.position[0];
			const firstChunkY = firstChunk.position[1];

			const isAlphaMaps = quality === -1;
			const isLargeBake = quality >= 8192;
			const isSplittingAlphaMaps = isAlphaMaps && core.view.config.splitAlphaMaps;
			const isSplittingTextures = isLargeBake && core.view.config.splitLargeTerrainBakes;
			const includeHoles = core.view.config.mapsIncludeHoles;
		
			let ofs = 0;
			let chunkID = 0;
			for (let x = 0, midX = 0; x < 16; x++) {
				for (let y = 0; y < 16; y++) {
					const indices = [];

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
							let vy = chunk.vertices[idx] + chunkZ;
							let vz = chunkX - (row * UNIT_SIZE_HALF);

							if (isShort)
								vx -= UNIT_SIZE_HALF;

							const vIndex = midX * 3;
							vertices[vIndex + 0] = vx;
							vertices[vIndex + 1] = vy;
							vertices[vIndex + 2] = vz;

							const normal = chunk.normals[idx];
							normals[vIndex + 0] = normal[0] / 127;
							normals[vIndex + 1] = normal[1] / 127;
							normals[vIndex + 2] = normal[2] / 127;

							const cIndex = midX * 4;
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
							const uvIndex = midX * 2;

							uvsBake[uvIndex + 0] = -(vx - firstChunkX) / TILE_SIZE;
							uvsBake[uvIndex + 1] = (vz - firstChunkY) / TILE_SIZE;

							if (quality === 0) {
								uvs[uvIndex + 0] = uvIdx / 8;
								uvs[uvIndex + 1] = (row * 0.5) / 8;
							} else if (isSplittingTextures || isSplittingAlphaMaps) {
								uvs[uvIndex + 0] = uvIdx / 8;
								uvs[uvIndex + 1] = 1 - (row / 16);
							} else {
								uvs[uvIndex + 0] = uvsBake[uvIndex + 0];
								uvs[uvIndex + 1] = uvsBake[uvIndex + 1];
							}

							idx++;
							midX++;
						}
					}

					const holesHighRes = chunk.holesHighRes;
					for (let j = 9, xx = 0, yy = 0; j < 145; j++, xx++) {
						if (xx >= 8) {
							xx = 0;
							yy++;
						}

						let isHole = true;
						if (includeHoles === true) {
							if (!(chunk.flags & 0x10000)) {
								const current = Math.trunc(Math.pow(2, Math.floor(xx / 2) + Math.floor(yy / 2) * 4));

								if (!(chunk.holesLowRes & current))
									isHole = false;
							} else {
								if (!((holesHighRes[yy] >> xx) & 1))
									isHole = false;
							}
						} else {
							isHole = false;
						}

						if (!isHole) {
							const indOfs = ofs + j;
							indices.push(indOfs, indOfs - 9, indOfs + 8);
							indices.push(indOfs, indOfs - 8, indOfs - 9);
							indices.push(indOfs, indOfs + 9, indOfs - 8);
							indices.push(indOfs, indOfs + 8, indOfs + 9);
						}

						if (!((j + 1) % (9 + 8)))
							j += 9;
					}
				
					ofs = midX;

					if (isSplittingTextures || isSplittingAlphaMaps) {
						const objName = this.tileID + '_' + chunkID;
						const matName = 'tex_' + objName;
						mtl.addMaterial(matName, matName + '.png');
						obj.addMesh(objName, indices, matName);
					} else {
						obj.addMesh(chunkID, indices, 'tex_' + this.tileID);
					}
					chunkMeshes[chunkIndex] = indices;

					chunkID++;
				}
			}

			if ((!isAlphaMaps && !isSplittingTextures) || (isAlphaMaps && !isSplittingAlphaMaps))
				mtl.addMaterial('tex_' + this.tileID, 'tex_' + this.tileID + '.png');

			obj.setVertArray(vertices);
			obj.setNormalArray(normals);
			obj.addUVArray(uvs);

			if (!mtl.isEmpty)
				obj.setMaterialLibrary(path.basename(mtl.out));
			
			await obj.write(config.overwriteFiles);
			await mtl.write(config.overwriteFiles);

			if (quality !== 0) {
				if (isAlphaMaps) {
					// Export alpha maps.

					// Create a 2D canvas for drawing the alpha maps.
					const canvas = document.createElement('canvas');
					const ctx = canvas.getContext('2d');

					const materialIDs = texAdt.diffuseTextureFileDataIDs;
					const heightIDs = texAdt.heightTextureFileDataIDs;
					const texParams = texAdt.texParams;

					const saveLayerTexture = async (fileDataID) => {
						const blp = new BLPFile(await core.view.casc.getFile(fileDataID));
						let fileName = listfile.getByID(fileDataID);
						if (fileName !== undefined)
							fileName = ExportHelper.replaceExtension(fileName, '.png');
						else
							fileName = listfile.formatUnknownFile(fileDataID, '.png');
					
						let texFile;
						let texPath;
					
						if (config.enableSharedTextures) {
							texPath = ExportHelper.getExportPath(fileName);
							texFile = path.relative(dir, texPath);
						} else {
							texPath = path.join(dir, path.basename(fileName));
							texFile = path.basename(texPath);
						}
					
						await blp.saveToPNG(texPath);
					
						return usePosix ? ExportHelper.win32ToPosix(texFile) : texFile;
					};

					// Export the raw diffuse textures to disk.
					const materials = new Array(materialIDs.length);
					for (let i = 0, n = materials.length; i < n; i++) {
						// Abort if the export has been cancelled.
						if (helper.isCancelled())
							return;

						const diffuseFileDataID = materialIDs[i];
						const heightFileDataID = heightIDs[i] ?? 0;
						if (diffuseFileDataID === 0)
							continue;

						const mat = materials[i] = { scale: 1, fileDataID: diffuseFileDataID };
						mat.file = await saveLayerTexture(diffuseFileDataID);

						// Include a reference to the height map texture if it exists.
						if (heightFileDataID > 0) {
							mat.heightFile = await saveLayerTexture(heightFileDataID);
							mat.heightFileDataID = heightFileDataID;
						}

						if (texParams && texParams[i]) {
							const params = texParams[i];
							mat.scale = Math.pow(2, (params.flags & 0xF0) >> 4);

							if (params.height !== 0 || params.offset !== 1) {
								mat.heightScale = params.height;
								mat.heightOffset = params.offset;
							}
						}
					}

					// Alpha maps are 64x64, we're not up-scaling here.
					if (isSplittingAlphaMaps) {
						// Each individual tile will be exported separately.
						canvas.width = 64;
						canvas.height = 64;
					} else {
						// Tiles will be drawn onto one big image.
						canvas.width = 64 * 16;
						canvas.height = 64 * 16;
					}

					const chunks = texAdt.texChunks;
					const chunkCount = chunks.length;

					helper.setCurrentTaskName('Tile ' + this.tileID + ' alpha maps');
					helper.setCurrentTaskMax(16 * 16);

					const layers = [];
					const vertexColors = [];

					for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
						// Abort if the export has been cancelled.
						if (helper.isCancelled())
							return;

						helper.setCurrentTaskValue(chunkIndex);

						const texChunk = texAdt.texChunks[chunkIndex];
						const rootChunk = rootAdt.chunks[chunkIndex];

						const fix_alpha_map = !(rootChunk.flags & (1 << 15));

						const alphaLayers = texChunk.alphaLayers || [];
						const imageData = ctx.createImageData(64, 64);

						// Write each layer as RGB.
						for (let i = 1; i < alphaLayers.length; i++) {
							const layer = alphaLayers[i];

							for (let j = 0; j < layer.length; j++) {
								const isLastColumn = (j % 64) === 63;
								const isLastRow = j >= 63 * 64;
							
								// fix_alpha_map: layer is 63x63, fill last column/row.
								if (fix_alpha_map) {
									if (isLastColumn && !isLastRow) {
										imageData.data[(j * 4) + (i - 1)] = layer[j - 1];
									} else if (isLastRow) {
										const prevRowIndex = j - 64;
										imageData.data[(j * 4) + (i - 1)] = layer[prevRowIndex];
									} else {
										imageData.data[(j * 4) + (i - 1)] = layer[j];
									}
								} else {
									imageData.data[(j * 4) + (i - 1)] = layer[j];
								}
							}
						}

						// Set all the alpha values to max.
						for (let i = 0; i < 64 * 64; i++)
							imageData.data[(i * 4) + 3] = 255;

						if (isSplittingAlphaMaps) {
							// Export tile as an individual file.
							ctx.putImageData(imageData, 0, 0);

							const prefix = this.tileID + '_' + chunkIndex;
							const tilePath = path.join(dir, 'tex_' + prefix + '.png');

							const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');
							await buf.writeToFile(tilePath);

							const texLayers = texChunk.layers;
							for (let i = 0, n = texLayers.length; i < n; i++) {
								const layer = texLayers[i];
								const mat = materials[layer.textureId];
								if (mat !== undefined)
									layers.push(Object.assign({ index: i, effectID: layer.effectID }, mat));
							}

							const json = new JSONWriter(path.join(dir, 'tex_' + prefix + '.json'));
							json.addProperty('layers', layers);
							
							if (rootChunk.vertexShading)
								json.addProperty('vertexColors', rootChunk.vertexShading.map(e => rgbaToInt(e)));

							await json.write();

							layers.length = 0;
						} else {
							const chunkX = chunkIndex % 16;
							const chunkY = Math.floor(chunkIndex / 16);

							// Export as part of a merged alpha map.
							ctx.putImageData(imageData, 64 * chunkX, 64 * chunkY);
						
							const texLayers = texChunk.layers;
							for (let i = 0, n = texLayers.length; i < n; i++) {
								const layer = texLayers[i];
								const mat = materials[layer.textureId];
								if (mat !== undefined)
									layers.push(Object.assign({ index: i, chunkIndex, effectID: layer.effectID }, mat));
							}

							if (rootChunk.vertexShading)
								vertexColors.push({ chunkIndex, shading: rootChunk.vertexShading.map(e => rgbaToInt(e)) });
						}
					}

					// For combined alpha maps, export everything together once done.
					if (!isSplittingAlphaMaps) {
						const mergedPath = path.join(dir, 'tex_' + this.tileID + '.png');
						const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');
						await buf.writeToFile(mergedPath);

						const json = new JSONWriter(path.join(dir, 'tex_' + this.tileID + '.json'));
						json.addProperty('layers', layers);

						if (vertexColors.length > 0)
							json.addProperty('vertexColors', vertexColors);

						await json.write();
					}
				} else if (quality <= 512) {
					// Use minimaps for cheap textures.
					const paddedX = this.tileY.toString().padStart(2, '0');
					const paddedY = this.tileX.toString().padStart(2, '0');
					const tilePath = util.format('world/minimaps/%s/map%s_%s.blp', this.mapDir, paddedX, paddedY);
					const tileOutPath = path.join(dir, 'tex_' + this.tileID + '.png');

					if (config.overwriteFiles || !await generics.fileExists(tileOutPath)) {
						const data = await casc.getFileByName(tilePath, false, true);
						const blp = new BLPFile(data);

						// Draw the BLP onto a raw-sized canvas.
						const canvas = blp.toCanvas(0b0111);

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
						await buf.writeToFile(tileOutPath);
					} else {
						log.write('Skipping ADT bake of %s (file exists, overwrite disabled)', tileOutPath);
					}
				} else {
					const hasHeightTexturing = (wdt.flags & 0x80) === 0x80;
					const tileOutPath = path.join(dir, 'tex_' + this.tileID + '.png');

					let composite, compositeCtx;
					if (!isSplittingTextures) {
						composite = new OffscreenCanvas(quality, quality);
						compositeCtx = composite.getContext('2d');
					}

					if (isSplittingTextures || config.overwriteFiles || !await generics.fileExists(tileOutPath)) {
						// Create new GL context and compile shaders.
						if (!gl) {
							glCanvas = document.createElement('canvas');
							gl = glCanvas.getContext('webgl');

							await compileShaders(!hasHeightTexturing);
						}

						// Materials
						const materialIDs = texAdt.diffuseTextureFileDataIDs;
						const heightIDs = texAdt.heightTextureFileDataIDs;
						const texParams = texAdt.texParams;

						helper.setCurrentTaskName('Tile ' + this.tileID + ', loading textures');
						helper.setCurrentTaskMax(materialIDs.length);

						const materials = new Array(materialIDs.length);
						for (let i = 0, n = materials.length; i < n; i++) {
							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;

							helper.setCurrentTaskValue(i);

							const diffuseFileDataID = materialIDs[i];
							const heightFileDataID = heightIDs[i];

							if (diffuseFileDataID === 0)
								continue;

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

							if (hasHeightTexturing)
								uHeights[i] = gl.getUniformLocation(glShaderProg, 'pt_height' + i);

							if (i > 0)
								uBlends[i] = gl.getUniformLocation(glShaderProg, 'pt_blend' + i);
						}

						let uHeightScale;
						let uHeightOffset;

						if (hasHeightTexturing) {
							uHeightScale = gl.getUniformLocation(glShaderProg, 'pc_heightScale');
							uHeightOffset = gl.getUniformLocation(glShaderProg, 'pc_heightOffset');
						}

						const uTranslation = gl.getUniformLocation(glShaderProg, 'uTranslation');
						const uResolution = gl.getUniformLocation(glShaderProg, 'uResolution');
						const uZoom = gl.getUniformLocation(glShaderProg, 'uZoom');

						glCanvas.width = quality / 16;
						glCanvas.height = quality / 16;

						// Set up a rotation canvas.
						const rotateCanvas = new OffscreenCanvas(glCanvas.width, glCanvas.height);
						const rotateCtx = rotateCanvas.getContext('2d');

						rotateCtx.translate(rotateCanvas.width / 2, rotateCanvas.height / 2);
						rotateCtx.rotate(Math.PI / 180 * 180);

						clearCanvas();

						gl.uniform2f(uResolution, TILE_SIZE, TILE_SIZE);

						const vertexBuffer = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
						gl.enableVertexAttribArray(aVertexPosition);
						gl.vertexAttribPointer(aVertexPosition, 3, gl.FLOAT, false, 0, 0);

						const uvBuffer = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvsBake), gl.STATIC_DRAW);
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

						gl.uniform1f(uZoom, 0.0625);

						helper.setCurrentTaskName('Tile ' + this.tileID + ', baking textures');
						helper.setCurrentTaskMax(16 * 16);
						
						const tileSize = quality / 16;

						let chunkID = 0;
						for (let x = 0; x < 16; x++) {
							for (let y = 0; y < 16; y++) {
								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								helper.setCurrentTaskValue(chunkID);

								const ofsX = -deltaX - (CHUNK_SIZE * 7.5) + (y * CHUNK_SIZE);
								const ofsY = -deltaY - (CHUNK_SIZE * 7.5) + (x * CHUNK_SIZE);

								gl.uniform2f(uTranslation, ofsX, ofsY);

								const chunkIndex = (x * 16) + y;
								const texChunk = texAdt.texChunks[chunkIndex];
								const indices = chunkMeshes[chunkIndex];

								const alphaLayers = texChunk.alphaLayers || [];
								const alphaTextures = new Array(alphaLayers.length);

								for (let i = 1; i < alphaLayers.length; i++) {
									gl.activeTexture(gl.TEXTURE3 + i);

									const alphaTex = bindAlphaLayer(alphaLayers[i]);
									gl.bindTexture(gl.TEXTURE_2D, alphaTex);
									
									gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
									gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

									gl.uniform1i(uBlends[i], i + 3);

									// Store to clean up after render.
									alphaTextures[i] = alphaTex;
								}

								const texLayers = texChunk.layers;
								const heightScales = new Array(4).fill(1);
								const heightOffsets = new Array(4).fill(1);

								for (let i = 0, n = texLayers.length; i < n; i++) {
									const mat = materials[texLayers[i].textureId];
									if (mat === undefined)
										continue;

									gl.activeTexture(gl.TEXTURE0 + i);
									gl.bindTexture(gl.TEXTURE_2D, mat.diffuseTex);

									gl.uniform1i(uLayers[i], i);
									gl.uniform1f(uScales[i], mat.scale);

									if (hasHeightTexturing && mat.heightTex) {
										gl.activeTexture(gl.TEXTURE7 + i);
										gl.bindTexture(gl.TEXTURE_2D, mat.heightTex);

										gl.uniform1i(uHeights[i], 7 + i);
										heightScales[i] = mat.heightScale;
										heightOffsets[i] = mat.heightOffset;
									}
								}

								if (hasHeightTexturing) {
									gl.uniform4f(uHeightScale, ...heightScales);
									gl.uniform4f(uHeightOffset, ...heightOffsets);
								}

								const indexBuffer = gl.createBuffer();
								gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
								gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
								gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

								unbindAllTextures();
								
								// Destroy alpha layers rendered for the tile.
								for (const tex of alphaTextures)
									gl.deleteTexture(tex);

								if (isSplittingTextures) {
									// Save this individual chunk.
									const tilePath = path.join(dir, 'tex_' + this.tileID + '_' + (chunkID++) + '.png');

									if (config.overwriteFiles || !await generics.fileExists(tilePath)) {
										rotateCtx.drawImage(glCanvas, -(rotateCanvas.width / 2), -(rotateCanvas.height / 2));

										const buf = await BufferWrapper.fromCanvas(rotateCanvas, 'image/png');
										await buf.writeToFile(tilePath);
									}
								} else {
									// Store as part of a larger composite.
									rotateCtx.drawImage(glCanvas, -(rotateCanvas.width / 2), -(rotateCanvas.height / 2));

									const chunkX = chunkIndex % 16;
									const chunkY = Math.floor(chunkIndex / 16);
									compositeCtx.drawImage(rotateCanvas, chunkX * tileSize, chunkY * tileSize);
								}
							}
						}

						// Save the completed composite tile.
						if (!isSplittingTextures) {
							const buf = await BufferWrapper.fromCanvas(composite, 'image/png');
							await buf.writeToFile(path.join(dir, 'tex_' + this.tileID + '.png'));
						}

						// Clear buffer.
						gl.bindBuffer(gl.ARRAY_BUFFER, null);

						// Delete loaded textures.
						for (const mat of materials) {
							if (mat !== undefined)
								gl.deleteTexture(mat.texture);
						}
					}
				}
			}
		} else {
			const saveRawLayerTexture = async (fileDataID) => {
				if (fileDataID === 0)
					return;

				const blp = await core.view.casc.getFile(fileDataID);

				let fileName = listfile.getByID(fileDataID);
				if (fileName !== undefined)
					fileName = ExportHelper.replaceExtension(fileName, '.blp');
				else
					fileName = listfile.formatUnknownFile(fileDataID, '.blp');
			
				let texFile;
				let texPath;
			
				if (config.enableSharedTextures) {
					texPath = ExportHelper.getExportPath(fileName);
					texFile = path.relative(dir, texPath);
				} else {
					texPath = path.join(dir, path.basename(fileName));
					texFile = path.basename(texPath);
				}
			
				await blp.writeToFile(texPath);
			
				return usePosix ? ExportHelper.win32ToPosix(texFile) : texFile;
			};

			const materialIDs = texAdt.diffuseTextureFileDataIDs;
			for (const fileDataID of materialIDs)
				await saveRawLayerTexture(fileDataID);
			
			const heightIDs = texAdt.heightTextureFileDataIDs;
			for (const fileDataID of heightIDs)
				await saveRawLayerTexture(fileDataID);
		}

		// Export dooads / WMOs.
		if (config.mapsIncludeWMO || config.mapsIncludeM2 || config.mapsIncludeGameObjects) {
			const objectCache = new Set();

			const csvPath = path.join(dir, 'adt_' + this.tileID + '_ModelPlacementInformation.csv');
			if (config.overwriteFiles || !await generics.fileExists(csvPath)) {
				const csv = new CSVWriter(csvPath);
				csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationX', 'RotationY', 'RotationZ', 'RotationW', 'ScaleFactor', 'ModelId', 'Type', 'FileDataID', 'DoodadSetIndexes', 'DoodadSetNames');

				const exportObjects = async (exportType, objects, csvName) => {
					const nObjects = objects?.length ?? objects.size;
					log.write('Exporting %d %s for ADT...', nObjects, exportType);

					helper.setCurrentTaskName('Tile ' + this.tileID + ', ' + exportType);
					helper.setCurrentTaskMax(nObjects);

					let index = 0;
					for (const model of objects) {
						helper.setCurrentTaskValue(index++);

						const fileDataID = model.FileDataID ?? model.mmidEntry;
						let fileName = listfile.getByID(fileDataID);

						if (!config.mapsExportRaw) {
							if (fileName !== undefined) {
								// Replace M2 extension with OBJ.
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								// Handle unknown file.
								fileName = listfile.formatUnknownFile(fileDataID, '.obj');
							}
						}

						let modelPath;
						if (config.enableSharedChildren)
							modelPath = ExportHelper.getExportPath(fileName);
						else
							modelPath = path.join(dir, path.basename(fileName));

						try {
							if (!objectCache.has(fileDataID)) {
								const data = await casc.getFile(fileDataID);
								const m2 = new M2Exporter(data, undefined, fileDataID);

								if (config.mapsExportRaw)
									await m2.exportRaw(modelPath, helper);
								else
									await m2.exportAsOBJ(modelPath, config.modelsExportCollision, helper);
								
								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								objectCache.add(fileDataID);
							}

							let modelFile = path.relative(dir, modelPath);
							if (usePosix)
								modelFile = ExportHelper.win32ToPosix(modelFile);

							csv.addRow({
								ModelFile: modelFile,
								PositionX: model.Position?.[0] ?? model.position[0],
								PositionY: model.Position?.[1] ?? model.position[1],
								PositionZ: model.Position?.[2] ?? model.position[2],
								RotationX: model.Rotation?.[0] ?? model.rotation[0],
								RotationY: model.Rotation?.[1] ?? model.rotation[1],
								RotationZ: model.Rotation?.[2] ?? model.rotation[2],
								RotationW: model.Rotation?.[3] ?? model.rotation[3],
								ScaleFactor: model.scale !== undefined ? model.scale / 1024 : 1,
								ModelId: model.uniqueId ?? 0,
								Type: csvName,
								FileDataID: fileDataID,
								DoodadSetIndexes: 0,
								DoodadSetNames: ''
							});
						} catch (e) {
							log.write('Failed to export %s [%d]', fileName, fileDataID);
							log.write('Error: %s', e);
						}
					}
				};

				if (config.mapsIncludeGameObjects === true && gameObjects !== undefined && gameObjects.size > 0)
					await exportObjects('game objects', gameObjects, 'gobj');

				if (config.mapsIncludeM2)
					await exportObjects('doodads', objAdt.models, 'm2');

				if (config.mapsIncludeWMO) {
					log.write('Exporting %d WMOs for ADT...', objAdt.worldModels.length);

					helper.setCurrentTaskName('Tile ' + this.tileID + ', WMO objects');
					helper.setCurrentTaskMax(objAdt.worldModels.length);

					const setNameCache = new Map();

					let worldModelIndex = 0;
					const usingNames = !!objAdt.wmoNames;
					for (const model of objAdt.worldModels) {
						const useADTSets = model & 0x80;
						const singleWMO = config.mapsSingleWMO && !useADTSets;
						helper.setCurrentTaskValue(worldModelIndex++);

						let fileDataID;
						let fileName;

						try {
							if (usingNames) {
								fileName = objAdt.wmoNames[objAdt.wmoOffsets[model.mwidEntry]];
								fileDataID = listfile.getByFilename(fileName);
							} else {
								fileDataID = model.mwidEntry;
								fileName = listfile.getByID(fileDataID);
							}

							if (!config.mapsExportRaw) {
								let fileNameSuffix = '_set' + model.doodadSet + '.obj';
								if (singleWMO)
									fileNameSuffix = '.obj';

								if (fileName !== undefined) {
									// Replace WMO extension with OBJ.
									fileName = ExportHelper.replaceExtension(fileName, fileNameSuffix);
								} else {
									// Handle unknown WMO files.
									fileName = listfile.formatUnknownFile(fileDataID, fileNameSuffix);
								}
							}

							let modelPath;
							if (config.enableSharedChildren)
								modelPath = ExportHelper.getExportPath(fileName);
							else
								modelPath = path.join(dir, path.basename(fileName));

							const doodadSets = useADTSets ? objAdt.doodadSets : [model.doodadSet];
							if (doodadSets.indexOf(0) === -1) {
								// also add the default set to the list, since it's always exported
								doodadSets.splice(0, 0, 0);
							}
							let cacheID = fileDataID + '-' + doodadSets.join(',');
							if (singleWMO)
								cacheID = fileDataID;

							if (!objectCache.has(cacheID)) {
								const data = await casc.getFile(fileDataID);
								const wmoLoader = new WMOExporter(data, fileDataID);

								await wmoLoader.wmo.load();

								setNameCache.set(fileDataID, wmoLoader.wmo.doodadSets.map(e => e.name));

								if (config.mapsIncludeWMOSets) {
									const mask = { 0: { checked: true } };
									if (useADTSets) {
										for (const setIndex of objAdt.doodadSets)
											mask[setIndex] = { checked: true };
									} else {
										if (singleWMO) {
											for (let setIndex = 0; setIndex < wmoLoader.wmo.doodadSets.length; setIndex++)
												mask[setIndex] = { checked: true };
										} else {
											mask[model.doodadSet] = { checked: true };
										}
									}

									wmoLoader.setDoodadSetMask(mask);
								}

								if (config.mapsExportRaw)
									await wmoLoader.exportRaw(modelPath, helper);
								else
									await wmoLoader.exportAsOBJ(modelPath, helper);

								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								objectCache.add(cacheID);
							}

							const doodadNames = setNameCache.get(fileDataID);

							let modelFile = path.relative(dir, modelPath);
							if (usePosix)
								modelFile = ExportHelper.win32ToPosix(modelFile);

							csv.addRow({
								ModelFile: modelFile,
								PositionX: model.position[0],
								PositionY: model.position[1],
								PositionZ: model.position[2],
								RotationX: model.rotation[0],
								RotationY: model.rotation[1],
								RotationZ: model.rotation[2],
								RotationW: 0,
								ScaleFactor: model.scale / 1024,
								ModelId: model.uniqueId,
								Type: 'wmo',
								FileDataID: fileDataID,
								DoodadSetIndexes: doodadSets.join(','),
								DoodadSetNames: doodadSets.map(e => doodadNames[e]).join(',')
							});
						} catch (e) {
							log.write('Failed to export %s [%d]', fileName, fileDataID);
							log.write('Error: %s', e);
						}
					}

					WMOExporter.clearCache();
				}

				await csv.write();
			} else {
				log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
			}
		}

		// Export liquids.
		if (config.mapsIncludeLiquid && rootAdt.liquidChunks) {
			const liquidFile = path.join(dir, 'liquid_' + this.tileID + '.json');
			log.write('Exporting liquid data to %s', liquidFile);

			const liquidJSON = new JSONWriter(liquidFile);
			liquidJSON.addProperty('liquidChunks', rootAdt.liquidChunks)
			await liquidJSON.write();
		}

		// Prepare foliage data tables if needed.
		if (config.mapsIncludeFoliage && !hasLoadedFoliage)
			await loadFoliageTables();

		// Export foliage.
		if (config.mapsIncludeFoliage && isFoliageAvailable) {
			const foliageExportCache = new Set();
			const foliageEffectCache = new Set();
			const foliageDir = path.join(dir, 'foliage');
			
			log.write('Exporting foliage to %s', foliageDir);

			for (const chunk of texAdt.texChunks) {
				// Skip chunks that have no layers?
				if (!chunk.layers)
					continue;

				for (const layer of chunk.layers) {
					// Skip layers with no effect.
					if (!layer.effectID)
						continue;

					const groundEffectTexture = dbTextures.getRow(layer.effectID);
					if (!groundEffectTexture || !Array.isArray(groundEffectTexture.DoodadID))
						continue;

					// Create a foliage metadata JSON packed with the table data.
					let foliageJSON;
					if (core.view.config.exportFoliageMeta && !foliageEffectCache.has(layer.effectID)) {
						foliageJSON = new JSONWriter(path.join(foliageDir, layer.effectID + '.json'));
						foliageJSON.data = groundEffectTexture;

						foliageEffectCache.add(layer.effectID);
					}

					const doodadModelIDs = {};
					for (const doodadEntryID of groundEffectTexture.DoodadID) {
						// Skip empty fields.
						if (!doodadEntryID)
							continue;

						const groundEffectDoodad = dbDoodads.getRow(doodadEntryID);
						if (groundEffectDoodad) {
							const modelID = groundEffectDoodad.ModelFileID;
							doodadModelIDs[doodadEntryID] = { fileDataID: modelID };
							if (!modelID || foliageExportCache.has(modelID))
								continue;

							foliageExportCache.add(modelID);
						}
					}

					if (foliageJSON) {
						// Map fileDataID to the exported OBJ file names.
						for (const entry of Object.values(doodadModelIDs)) {
							const fileName = listfile.getByID(entry.fileDataID);

							if (config.mapsExportRaw)
								entry.fileName = path.basename(fileName);
							else
								entry.fileName = ExportHelper.replaceExtension(path.basename(fileName), '.obj');
						}

						foliageJSON.addProperty('DoodadModelIDs', doodadModelIDs);
						await foliageJSON.write();
					}
				}
			}

			helper.setCurrentTaskName('Tile ' + this.tileID + ', foliage doodads');
			helper.setCurrentTaskMax(foliageExportCache.size);

			// Export foliage after collecting to give an accurate progress count.
			let foliageIndex = 0;
			for (const modelID of foliageExportCache) {
				helper.setCurrentTaskValue(foliageIndex++);
				
				const modelName = path.basename(listfile.getByID(modelID));
				
				const data = await casc.getFile(modelID);
				const m2 = new M2Exporter(data, undefined, modelID);

				if (config.mapsExportRaw) {
					await m2.exportRaw(path.join(foliageDir, modelName), helper);
				} else {
					const modelPath = ExportHelper.replaceExtension(modelName, '.obj');
					await m2.exportAsOBJ(path.join(foliageDir, modelPath), config.modelsExportCollision, helper);
				}

				// Abort if the export has been cancelled.
				if (helper.isCancelled())
					return;
			}
		}

		return out;
	}

	/**
	 * Clear internal tile-loading cache.
	 */
	static clearCache() {
		wdtCache.clear();
	}
}

module.exports = ADTExporter;