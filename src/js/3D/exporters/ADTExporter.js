/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import constants from '../../constants.js';
import BufferWrapper from '../../buffer.js';
import BLPImage from '../../casc/blp.js';
import OBJWriter from '../writers/OBJWriter.js';
import PNGWriter from '../../png-writer.js';
import ExportHelper from '../../export-helper.js';
import WMOExporter from '../../3D/exporters/WMOExporter.js';
import JSONWriter from '../../3D/writers/JSONWriter.js';
import core from '../../core.js';
import generics from '../../generics.js';
import log from '../../log.js';
import WDTLoader from '../loaders/WDTLoader.js';
import Shaders from '../Shaders.js';
import MTLWriter from '../writers/MTLWriter.js';
import { db, dbc, listfile } from '../../../views/main/rpc.js';
import M2Exporter from '../../3D/exporters/M2Exporter.js';
import ADTLoader from '../loaders/ADTLoader.js';
import CSVWriter from '../../3D/writers/CSVWriter.js';











const MAP_SIZE = constants.GAME.MAP_SIZE;
const TILE_SIZE = constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const wdtCache = new Map();

let isFoliageAvailable = false;
let hasLoadedFoliage = false;

let glShaderProg;
let glCanvas;
let gl;

/**
 * Load a texture from CASC and bind it to the GL context.
 * @param {number} fileDataID 
 */
const loadTexture = async (fileDataID) => {
	const texture = gl.createTexture();
	const blp = new BLPImage(await core.view.casc.getFile(fileDataID));

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
			await db.preload('GroundEffectDoodad');
			await db.preload('GroundEffectTexture');

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
	for (let i = 0, n = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS); i < n; i++) {
		gl.activeTexture(gl.TEXTURE0 + i);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
	}
};

const build_texture_array = async (file_data_ids, is_height) => {
	// Force 512x512 to avoid canvas corruption
	const target_size = 512;

	const tex_array = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex_array);
	gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, target_size, target_size, file_data_ids.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

	for (let i = 0; i < file_data_ids.length; i++) {
		const blp = new BLPImage(await core.view.casc.getFile(file_data_ids[i]));
		const blp_rgba = blp.toUInt8Array(0);

		if (blp.width === target_size && blp.height === target_size) {
			// Direct upload without processing
			gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, target_size, target_size, 1, gl.RGBA, gl.UNSIGNED_BYTE, blp_rgba);
		} else {
			// Manual nearest-neighbor resize to avoid canvas corruption
			const resized = new Uint8Array(target_size * target_size * 4);
			const scale_x = blp.width / target_size;
			const scale_y = blp.height / target_size;

			for (let y = 0; y < target_size; y++) {
				for (let x = 0; x < target_size; x++) {
					const src_x = Math.floor(x * scale_x);
					const src_y = Math.floor(y * scale_y);
					const src_idx = (src_y * blp.width + src_x) * 4;
					const dst_idx = (y * target_size + x) * 4;

					resized[dst_idx] = blp_rgba[src_idx];
					resized[dst_idx + 1] = blp_rgba[src_idx + 1];
					resized[dst_idx + 2] = blp_rgba[src_idx + 2];
					resized[dst_idx + 3] = blp_rgba[src_idx + 3];
				}
			}

			gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, target_size, target_size, 1, gl.RGBA, gl.UNSIGNED_BYTE, resized);
		}
	}

	gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
	return tex_array;
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
 * Calculate number of images required for given layer count.
 * Each image can hold 4 layers (RGBA channels), starting from layer 1.
 * @param {number} layerCount Total number of layers including base layer 0
 * @returns {number} Number of images needed
 */
const calculateRequiredImages = (layerCount) => {
	if (layerCount <= 1) return 0; // no alpha layers to export
	return Math.ceil((layerCount - 1) / 4); // layer 0 is base, skip it
};

/**
 * Compile the vertex and fragment shaders used for baking.
 * Will be attached to the current GL context.
 */
const compileShaders = (useOld = false) => {
	const shader_name = useOld ? 'adt_old' : 'adt';
	const sources = Shaders.get_source(shader_name);

	glShaderProg = gl.createProgram();

	// Compile fragment shader.
	const fragShader = gl.createShader(gl.FRAGMENT_SHADER);
	gl.shaderSource(fragShader, sources.frag);
	gl.compileShader(fragShader);

	if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
		log.write('Fragment shader failed to compile: %s', gl.getShaderInfoLog(fragShader));
		throw new Error('Failed to compile fragment shader');
	}

	// Compile vertex shader.
	const vertShader = gl.createShader(gl.VERTEX_SHADER);
	gl.shaderSource(vertShader, sources.vert);
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
	 * Calculate UV bounds for normalization.
	 * @param {Object} rootAdt The root ADT data
	 * @param {number} firstChunkX First chunk X coordinate
	 * @param {number} firstChunkY First chunk Y coordinate
	 * @returns {Object} UV bounds {minU, maxU, minV, maxV}
	 */
	calculateUVBounds(rootAdt, firstChunkX, firstChunkY) {
		let minU = Infinity, maxU = -Infinity;
		let minV = Infinity, maxV = -Infinity;

		for (let x = 0; x < 16; x++) {
			for (let y = 0; y < 16; y++) {
				const chunk = rootAdt.chunks[x * 16 + y];
				if (!chunk || !chunk.vertices) continue;

				const chunkX = chunk.position[0];
				const chunkY = chunk.position[1];
				const chunkZ = chunk.position[2];

				for (let row = 0, idx = 0; row < 17; row++) {
					const isShort = !!(row % 2);
					const colCount = isShort ? 8 : 9;

					for (let col = 0; col < colCount; col++) {
						let vx = chunkY - (col * UNIT_SIZE);
						let vz = chunkX - (row * UNIT_SIZE_HALF);

						if (isShort)
							vx -= UNIT_SIZE_HALF;

						const u = -(vx - firstChunkX) / TILE_SIZE;
						const v = (vz - firstChunkY) / TILE_SIZE;

						minU = Math.min(minU, u);
						maxU = Math.max(maxU, u);
						minV = Math.min(minV, v);
						maxV = Math.max(maxV, v);

						idx++;
					}
				}
			}
		}

		return { minU, maxU, minV, maxV };
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

		const isRawExport = config.exportMapFormat === 'RAW';
		const out = { type: isRawExport ? 'ADT_RAW' : 'ADT_OBJ', path: '' };

		const usePosix = config.pathFormat === 'posix';
		const prefix = `world/maps/${this.mapDir}/${this.mapDir}`;

		// Load the WDT. We cache this to speed up exporting large amounts of tiles
		// from the same map. Make sure ADTLoader.clearCache() is called after exporting.
		let wdt = wdtCache.get(this.mapDir);
		if (!wdt) {
			const wdtFile = await casc.getFileByName(prefix + '.wdt');

			wdt = new WDTLoader(wdtFile);
			await wdt.load();
			wdtCache.set(this.mapDir, wdt);

			if (isRawExport) {
				await wdtFile.writeToFile(dir + '/' + this.mapDir + '.wdt');
				
				if (wdt.lgtFileDataID > 0) {
					const lgtFile = await casc.getFile(wdt.lgtFileDataID);
					lgtFile.writeToFile(dir + '/' + this.mapDir + '_lgt.wdt');
				}

				if (wdt.occFileDataID > 0) {
					const occFile = await casc.getFile(wdt.occFileDataID);
					occFile.writeToFile(dir + '/' + this.mapDir + '_occ.wdt');
				}

				if (wdt.fogsFileDataID > 0) {
					const fogsFile = await casc.getFile(wdt.fogsFileDataID);
					fogsFile.writeToFile(dir + '/' + this.mapDir + '_fogs.wdt');
				}

				if (wdt.mpvFileDataID > 0) {
					const mpvFile = await casc.getFile(wdt.mpvFileDataID);
					mpvFile.writeToFile(dir + '/' + this.mapDir + '_mpv.wdt');
				}

				if (wdt.texFileDataID > 0) {
					const texFile = await casc.getFile(wdt.texFileDataID);
					texFile.writeToFile(dir + '/' + this.mapDir + '.tex');
				}

				if (wdt.wdlFileDataID > 0) {
					const wdlFile = await casc.getFile(wdt.wdlFileDataID);
					wdlFile.writeToFile(dir + '/' + this.mapDir + '.wdl');
				}

				if (wdt.pd4FileDataID > 0) {
					const pd4File = await casc.getFile(wdt.pd4FileDataID);
					pd4File.writeToFile(dir + '/' + this.mapDir + '.pd4');
				}
			}
		}

		const tilePrefix = prefix + '_' + this.tileID;

		const maid = wdt.entries[this.tileIndex];
		const rootFileDataID = maid.rootADT > 0 ? maid.rootADT : await listfile.getByFilename(tilePrefix + '.adt');
		const tex0FileDataID = maid.tex0ADT > 0 ? maid.tex0ADT : await listfile.getByFilename(tilePrefix + '_tex0.adt');
		const obj0FileDataID = maid.obj0ADT > 0 ? maid.obj0ADT : await listfile.getByFilename(tilePrefix + '_obj0.adt');
		const obj1FileDataID = maid.obj1ADT > 0 ? maid.obj1ADT : await listfile.getByFilename(tilePrefix + '_obj1.adt');

		// Ensure we actually have the fileDataIDs for the files we need. LOD is not available on Classic.
		if (rootFileDataID === 0 || tex0FileDataID === 0 || obj0FileDataID === 0 || obj1FileDataID === 0)
			throw new Error('Missing fileDataID for ADT files: ' + [rootFileDataID, tex0FileDataID, obj0FileDataID].join(', '));

		const rootFile = await casc.getFile(rootFileDataID);
		const texFile = await casc.getFile(tex0FileDataID);
		const objFile = await casc.getFile(obj0FileDataID);

		if (isRawExport) {
			await rootFile.writeToFile(dir + '/' + this.mapDir + "_" + this.tileID + '.adt');
			await texFile.writeToFile(dir + '/' + this.mapDir + "_" + this.tileID + '_tex0.adt');
			await objFile.writeToFile(dir + '/' + this.mapDir + "_" + this.tileID + '_obj0.adt');

			// We only care about these when exporting raw files.
			const obj1File = await casc.getFile(obj1FileDataID);
			await obj1File.writeToFile(dir + '/' + this.mapDir + "_" + this.tileID + '_obj1.adt');

			// LOD is not available on Classic.
			if (maid.lodADT > 0) {
				const lodFile = await casc.getFile(maid.lodADT);
				await lodFile.writeToFile(dir + '/' + this.mapDir + "_" + this.tileID + '_lod.adt');
			}		
		}

		const rootAdt = new ADTLoader(rootFile);
		rootAdt.loadRoot();

		const texAdt = new ADTLoader(texFile);
		texAdt.loadTex(wdt);

		const objAdt = new ADTLoader(objFile);
		objAdt.loadObj();

		if (!isRawExport) {
			const vertices = new Array(16 * 16 * 145 * 3);
			const normals = new Array(16 * 16 * 145 * 3);
			const uvs = new Array(16 * 16 * 145 * 2);
			const uvsBake = new Array(16 * 16 * 145 * 2);
			const vertexColors = new Array(16 * 16 * 145 * 4);

			const chunkMeshes = new Array(256);

			const objOut = dir + '/' + 'adt_' + this.tileID + '.obj';
			out.path = objOut;

			const obj = new OBJWriter(objOut);
			const mtl = new MTLWriter(dir + '/' + 'adt_' + this.tileID + '.mtl');

			const firstChunk = rootAdt.chunks[0];
			const firstChunkX = firstChunk.position[0];
			const firstChunkY = firstChunk.position[1];

			const isAlphaMaps = quality === -1;
			const isLargeBake = quality >= 8192;
			const isSplittingAlphaMaps = isAlphaMaps && core.view.config.splitAlphaMaps;
			const isSplittingTextures = isLargeBake && core.view.config.splitLargeTerrainBakes;
			const includeHoles = core.view.config.mapsIncludeHoles;
		
			// Calculate UV bounds for single texture mode normalization
			let uvBounds = null;
			if (quality !== 0 && !isSplittingTextures && !isSplittingAlphaMaps)
				uvBounds = this.calculateUVBounds(rootAdt, firstChunkX, firstChunkY);
		
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

							const uRaw = -(vx - firstChunkX) / TILE_SIZE;
							const vRaw = (vz - firstChunkY) / TILE_SIZE;
							
							uvsBake[uvIndex + 0] = uRaw;
							uvsBake[uvIndex + 1] = vRaw;

							if (quality === 0) {
								uvs[uvIndex + 0] = uvIdx / 8;
								uvs[uvIndex + 1] = (row * 0.5) / 8;
							} else if (isSplittingTextures || isSplittingAlphaMaps) {
								uvs[uvIndex + 0] = uvIdx / 8;
								uvs[uvIndex + 1] = 1 - (row / 16);
							} else {
								// Single texture mode - apply normalization
								if (uvBounds) {
									uvs[uvIndex + 0] = (uRaw - uvBounds.minU) / (uvBounds.maxU - uvBounds.minU);
									uvs[uvIndex + 1] = (vRaw - uvBounds.minV) / (uvBounds.maxV - uvBounds.minV);
								} else {
									// Fallback to raw values if bounds calculation failed
									uvs[uvIndex + 0] = uRaw;
									uvs[uvIndex + 1] = vRaw;
								}
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

			if (quality !== 0 && ((!isAlphaMaps && !isSplittingTextures) || (isAlphaMaps && !isSplittingAlphaMaps)))
				mtl.addMaterial('tex_' + this.tileID, 'tex_' + this.tileID + '.png');

			obj.setVertArray(vertices);
			obj.setNormalArray(normals);
			obj.addUVArray(uvs);

			if (!mtl.isEmpty)
				obj.setMaterialLibrary(mtl.out.split('/').pop());
			
			await obj.write(config.overwriteFiles);
			await mtl.write(config.overwriteFiles);

			if (quality !== 0) {
				if (isAlphaMaps) {
					// Export alpha maps.

					const materialIDs = texAdt.diffuseTextureFileDataIDs;
					const heightIDs = texAdt.heightTextureFileDataIDs;
					const texParams = texAdt.texParams;

					const saveLayerTexture = async (fileDataID) => {
						const blp = new BLPImage(await core.view.casc.getFile(fileDataID));
						let fileName = await listfile.getByID(fileDataID);
						if (fileName !== undefined)
							fileName = ExportHelper.replaceExtension(fileName, '.png');
						else
							fileName = listfile.formatUnknownFile(fileDataID, '.png');
					
						let texFile;
						let texPath;
					
						if (config.enableSharedTextures) {
							texPath = ExportHelper.getExportPath(fileName);
							texFile = texPath.replace(dir, '');
						} else {
							texPath = dir + '/' + fileName.split('/').pop();
							texFile = texPath.split('/').pop();
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
						const requiredImages = calculateRequiredImages(alphaLayers.length);

						if (isSplittingAlphaMaps) {
							// Export individual chunk files with multi-image support
							const prefix = this.tileID + '_' + chunkIndex;
							const texLayers = texChunk.layers;

							for (let imageIndex = 0; imageIndex < Math.max(1, requiredImages); imageIndex++) {
								const pngWriter = new PNGWriter(64, 64);
								const pixelData = pngWriter.getPixelData();

								// Set unused channels to 0 and alpha channel to 255 if not used for data first
								for (let j = 0; j < 64 * 64; j++) {
									const pixelOffset = j * 4;
									pixelData[pixelOffset + 0] = 0; // R = 0
									pixelData[pixelOffset + 1] = 0; // G = 0
									pixelData[pixelOffset + 2] = 0; // B = 0
									pixelData[pixelOffset + 3] = 255; // A = 255
								}

								// Write layers to this image (4 layers per image starting from layer 1)
								const startLayer = (imageIndex * 4) + 1;
								const endLayer = Math.min(startLayer + 4, alphaLayers.length);

								for (let layerIdx = startLayer; layerIdx < endLayer; layerIdx++) {
									const layer = alphaLayers[layerIdx];
									const channelIdx = (layerIdx - startLayer); // 0, 1, 2, 3 for R, G, B, A

									for (let j = 0; j < layer.length; j++) {
										const isLastColumn = (j % 64) === 63;
										const isLastRow = j >= 63 * 64;

										// fix_alpha_map: layer is 63x63, fill last column/row.
										if (fix_alpha_map) {
											if (isLastColumn && !isLastRow) {
												pixelData[(j * 4) + channelIdx] = layer[j - 1];
											} else if (isLastRow) {
												const prevRowIndex = j - 64;
												pixelData[(j * 4) + channelIdx] = layer[prevRowIndex];
											} else {
												pixelData[(j * 4) + channelIdx] = layer[j];
											}
										} else {
											pixelData[(j * 4) + channelIdx] = layer[j];
										}
									}
								}

								// determine file name: first image keeps original naming, additional get suffix
								const imageSuffix = imageIndex === 0 ? '' : '_' + imageIndex;
								const tilePath = dir + '/' + 'tex_' + prefix + imageSuffix + '.png';

								await pngWriter.write(tilePath);
							}

							// Create JSON metadata with image/channel mapping
							for (let i = 0, n = texLayers.length; i < n; i++) {
								const layer = texLayers[i];
								const mat = materials[layer.textureId];
								if (mat !== undefined) {
									const layerInfo = Object.assign({
										index: i,
										effectID: layer.effectID,
										imageIndex: i === 0 ? 0 : Math.floor((i - 1) / 4),
										channelIndex: i === 0 ? -1 : (i - 1) % 4
									}, mat);
									layers.push(layerInfo);
								}
							}

							const json = new JSONWriter(dir + '/' + 'tex_' + prefix + '.json');
							json.addProperty('layers', layers);

							if (rootChunk.vertexShading)
								json.addProperty('vertexColors', rootChunk.vertexShading.map(e => rgbaToInt(e)));

							await json.write();

							layers.length = 0;
						} else {
							// Combined alpha maps - metadata collection for combined export
							const texLayers = texChunk.layers;
							for (let i = 0, n = texLayers.length; i < n; i++) {
								const layer = texLayers[i];
								const mat = materials[layer.textureId];
								if (mat !== undefined) {
									const layerInfo = Object.assign({
										index: i,
										chunkIndex,
										effectID: layer.effectID,
										imageIndex: i === 0 ? 0 : Math.floor((i - 1) / 4),
										channelIndex: i === 0 ? -1 : (i - 1) % 4
									}, mat);
									layers.push(layerInfo);
								}
							}

							if (rootChunk.vertexShading)
								vertexColors.push({ chunkIndex, shading: rootChunk.vertexShading.map(e => rgbaToInt(e)) });
						}
					}

					// For combined alpha maps, export everything together once done.
					if (!isSplittingAlphaMaps) {
						// determine max layers across all chunks to know how many images we need
						let maxLayersNeeded = 1;
						for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
							const texChunk = texAdt.texChunks[chunkIndex];
							const alphaLayers = texChunk.alphaLayers || [];
							const required = calculateRequiredImages(alphaLayers.length);
							maxLayersNeeded = Math.max(maxLayersNeeded, required);
						}

						// export multiple combined images if needed
						for (let imageIndex = 0; imageIndex < maxLayersNeeded; imageIndex++) {
							const pngWriter = new PNGWriter(64 * 16, 64 * 16);
							const pixelData = pngWriter.getPixelData();

							// Initialize all pixels to default values
							for (let i = 0; i < pixelData.length; i += 4) {
								pixelData[i + 0] = 0; // R = 0
								pixelData[i + 1] = 0; // G = 0
								pixelData[i + 2] = 0; // B = 0
								pixelData[i + 3] = 255; // A = 255
							}

							// process all chunks for this image
							for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
								const texChunk = texAdt.texChunks[chunkIndex];
								const rootChunk = rootAdt.chunks[chunkIndex];
								const fix_alpha_map = !(rootChunk.flags & (1 << 15));
								const alphaLayers = texChunk.alphaLayers || [];

								const chunkX = chunkIndex % 16;
								const chunkY = Math.floor(chunkIndex / 16);

								// Write layers to this image (4 layers per image starting from layer 1)
								const startLayer = (imageIndex * 4) + 1;
								const endLayer = Math.min(startLayer + 4, alphaLayers.length);

								for (let layerIdx = startLayer; layerIdx < endLayer; layerIdx++) {
									const layer = alphaLayers[layerIdx];
									const channelIdx = (layerIdx - startLayer); // 0, 1, 2, 3 for R, G, B, A

									for (let j = 0; j < layer.length; j++) {
										const isLastColumn = (j % 64) === 63;
										const isLastRow = j >= 63 * 64;

										// Calculate position in combined image
										const localX = j % 64;
										const localY = Math.floor(j / 64);
										const globalX = chunkX * 64 + localX;
										const globalY = chunkY * 64 + localY;
										const globalIndex = (globalY * (64 * 16) + globalX) * 4 + channelIdx;

										// fix_alpha_map: layer is 63x63, fill last column/row.
										if (fix_alpha_map) {
											if (isLastColumn && !isLastRow) {
												pixelData[globalIndex] = layer[j - 1];
											} else if (isLastRow) {
												const prevRowIndex = j - 64;
												pixelData[globalIndex] = layer[prevRowIndex];
											} else {
												pixelData[globalIndex] = layer[j];
											}
										} else {
											pixelData[globalIndex] = layer[j];
										}
									}
								}
							}

							// save the combined image
							const imageSuffix = imageIndex === 0 ? '' : '_' + imageIndex;
							const mergedPath = dir + '/' + 'tex_' + this.tileID + imageSuffix + '.png';
							await pngWriter.write(mergedPath);
						}

						// write json metadata
						const json = new JSONWriter(dir + '/' + 'tex_' + this.tileID + '.json');
						json.addProperty('layers', layers);

						if (vertexColors.length > 0)
							json.addProperty('vertexColors', vertexColors);

						await json.write();
					}
				} else if (quality <= 512) {
					// Use minimaps for cheap textures.
					const paddedX = this.tileY.toString().padStart(2, '0');
					const paddedY = this.tileX.toString().padStart(2, '0');
					const tilePath = `world/minimaps/${this.mapDir}/map${paddedX}_${paddedY}.blp`;
					const tileOutPath = dir + '/' + 'tex_' + this.tileID + '.png';

					if (config.overwriteFiles || !await generics.fileExists(tileOutPath)) {
						const data = await casc.getFileByName(tilePath, false, true);
						const blp = new BLPImage(data);

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
					const tileOutPath = dir + '/' + 'tex_' + this.tileID + '.png';

					let composite, compositeCtx;
					if (!isSplittingTextures) {
						composite = new OffscreenCanvas(quality, quality);
						compositeCtx = composite.getContext('2d');
					}

					if (isSplittingTextures || config.overwriteFiles || !await generics.fileExists(tileOutPath)) {
						// Create new GL context and compile shaders.
						if (!gl) {
							glCanvas = document.createElement('canvas');
							gl = glCanvas.getContext('webgl2');

							if (!gl)
								throw new Error('WebGL2 not supported');

							compileShaders(!hasHeightTexturing);
						}

						// Materials
						const materialIDs = texAdt.diffuseTextureFileDataIDs;
						const heightIDs = texAdt.heightTextureFileDataIDs;
						const texParams = texAdt.texParams;

						helper.setCurrentTaskName('Tile ' + this.tileID + ', building texture arrays');

						// collect unique texture ids for arrays
						const unique_diffuse_ids = [...new Set(materialIDs.filter(id => id !== 0))];
						const unique_height_ids = [...new Set(heightIDs.filter(id => id !== 0))];

						const diffuse_array = await build_texture_array(unique_diffuse_ids, false);
						const height_array = await build_texture_array(unique_height_ids.length > 0 ? unique_height_ids : unique_diffuse_ids, true);

						// map file data id -> array index
						const diffuse_id_to_index = new Map();
						unique_diffuse_ids.forEach((id, idx) => diffuse_id_to_index.set(id, idx));

						const height_id_to_index = new Map();
						(unique_height_ids.length > 0 ? unique_height_ids : unique_diffuse_ids).forEach((id, idx) => height_id_to_index.set(id, idx));

						// build material metadata
						const materials = new Array(materialIDs.length);
						for (let i = 0, n = materials.length; i < n; i++) {
							if (materialIDs[i] === 0)
								continue;

							const mat = materials[i] = {
								scale: 1,
								heightScale: 0,
								heightOffset: 1,
								diffuseIndex: diffuse_id_to_index.get(materialIDs[i]),
								heightIndex: heightIDs[i] ? height_id_to_index.get(heightIDs[i]) : diffuse_id_to_index.get(materialIDs[i])
							};

							if (texParams && texParams[i]) {
								const params = texParams[i];
								mat.scale = Math.pow(2, (params.flags & 0xF0) >> 4);

								if (params.height !== 0 || params.offset !== 1) {
									mat.heightScale = params.height;
									mat.heightOffset = params.offset;
								}
							}
						}

						const aVertexPosition = gl.getAttribLocation(glShaderProg, 'aVertexPosition');
						const aTexCoord = gl.getAttribLocation(glShaderProg, 'aTextureCoord');
						const aVertexColor = gl.getAttribLocation(glShaderProg, 'aVertexColor');

						const uDiffuseLayers = gl.getUniformLocation(glShaderProg, 'uDiffuseLayers');
						const uHeightLayers = gl.getUniformLocation(glShaderProg, 'uHeightLayers');
						const uLayerCount = gl.getUniformLocation(glShaderProg, 'uLayerCount');

						const uAlphaBlends = [];
						for (let i = 0; i < 7; i++)
							uAlphaBlends[i] = gl.getUniformLocation(glShaderProg, 'uAlphaBlend' + i);

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

						unbindAllTextures();

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
								const texLayers = texChunk.layers;

								const chunk_layer_count = Math.min(texLayers.length, 8);
								gl.uniform1i(uLayerCount, chunk_layer_count);

								// clear all texture bindings before setting up new ones
								unbindAllTextures();

								// rebind texture arrays
								gl.activeTexture(gl.TEXTURE0);
								gl.bindTexture(gl.TEXTURE_2D_ARRAY, diffuse_array);
								gl.uniform1i(uDiffuseLayers, 0);

								gl.activeTexture(gl.TEXTURE1);
								gl.bindTexture(gl.TEXTURE_2D_ARRAY, height_array);
								gl.uniform1i(uHeightLayers, 1);

								// bind alpha layers (units 2-8)
								const alphaLayers = texChunk.alphaLayers || [];
								const alphaTextures = new Array(8);

								for (let i = 1; i < Math.min(alphaLayers.length, 8); i++) {
									gl.activeTexture(gl.TEXTURE0 + 2 + (i - 1));
									const alphaTex = bindAlphaLayer(alphaLayers[i]);
									gl.bindTexture(gl.TEXTURE_2D, alphaTex);
									gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
									gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
									alphaTextures[i - 1] = alphaTex;
								}

								// set alpha blend uniforms for all 7 possible layers
								for (let i = 0; i < 7; i++)
									gl.uniform1i(uAlphaBlends[i], 2 + i);

								// set per-layer uniforms using chunk layer info
								const layer_scales = new Array(8).fill(1);
								const height_scales = new Array(8).fill(0);
								const height_offsets = new Array(8).fill(1);
								const diffuse_indices = new Array(8).fill(0);
								const height_indices = new Array(8).fill(0);

								for (let i = 0; i < chunk_layer_count; i++) {
									const mat = materials[texLayers[i].textureId];
									if (mat === undefined)
										continue;

									layer_scales[i] = mat.scale;
									height_scales[i] = mat.heightScale;
									height_offsets[i] = mat.heightOffset;
									diffuse_indices[i] = mat.diffuseIndex;
									height_indices[i] = mat.heightIndex;
								}

								for (let i = 0; i < 8; i++) {
									const loc = gl.getUniformLocation(glShaderProg, `uLayerScales[${i}]`);
									gl.uniform1f(loc, layer_scales[i]);
								}

								for (let i = 0; i < 8; i++) {
									const loc = gl.getUniformLocation(glShaderProg, `uHeightScales[${i}]`);
									gl.uniform1f(loc, height_scales[i]);
								}

								for (let i = 0; i < 8; i++) {
									const loc = gl.getUniformLocation(glShaderProg, `uHeightOffsets[${i}]`);
									gl.uniform1f(loc, height_offsets[i]);
								}

								for (let i = 0; i < 8; i++) {
									const loc = gl.getUniformLocation(glShaderProg, `uDiffuseIndices[${i}]`);
									gl.uniform1f(loc, diffuse_indices[i]);
								}

								for (let i = 0; i < 8; i++) {
									const loc = gl.getUniformLocation(glShaderProg, `uHeightIndices[${i}]`);
									gl.uniform1f(loc, height_indices[i]);
								}

								const indexBuffer = gl.createBuffer();
								gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
								gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
								gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

								// cleanup alpha textures
								for (const tex of alphaTextures) {
									if (tex) {
										gl.deleteTexture(tex);
									}
								}

								if (isSplittingTextures) {
									// Save this individual chunk.
									const tilePath = dir + '/' + 'tex_' + this.tileID + '_' + (chunkID++) + '.png';

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

						// cleanup texture arrays
						gl.deleteTexture(diffuse_array);
						gl.deleteTexture(height_array);

						// Save the completed composite tile.
						if (!isSplittingTextures) {
							const buf = await BufferWrapper.fromCanvas(composite, 'image/png');
							await buf.writeToFile(dir + '/' + 'tex_' + this.tileID + '.png');
						}

						// Clear buffer.
						gl.bindBuffer(gl.ARRAY_BUFFER, null);
					}
				}
			}
		} else {
			const saveRawLayerTexture = async (fileDataID) => {
				if (fileDataID === 0)
					return;

				const blp = await core.view.casc.getFile(fileDataID);

				let fileName = await listfile.getByID(fileDataID);
				if (fileName !== undefined)
					fileName = ExportHelper.replaceExtension(fileName, '.blp');
				else
					fileName = listfile.formatUnknownFile(fileDataID, '.blp');
			
				let texFile;
				let texPath;
			
				if (config.enableSharedTextures) {
					texPath = ExportHelper.getExportPath(fileName);
					texFile = texPath.replace(dir, '');
				} else {
					texPath = dir + '/' + fileName.split('/').pop();
					texFile = texPath.split('/').pop();
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

			const csvPath = dir + '/' + 'adt_' + this.tileID + '_ModelPlacementInformation.csv';
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
						let fileName = await listfile.getByID(fileDataID);

						if (!isRawExport) {
							if (fileName !== undefined) {
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								fileName = listfile.formatUnknownFile(fileDataID, '.obj');
							}
						}

						let modelPath;
						if (config.enableSharedChildren)
							modelPath = ExportHelper.getExportPath(fileName);
						else
							modelPath = dir + '/' + fileName.split('/').pop();

						try {
							if (!objectCache.has(fileDataID)) {
								const data = await casc.getFile(fileDataID);
								const m2 = new M2Exporter(data, undefined, fileDataID);

								if (isRawExport)
									await m2.exportRaw(modelPath, helper);
								else
									await m2.exportAsOBJ(modelPath, config.modelsExportCollision, helper);
								
								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								objectCache.add(fileDataID);
							}

							let modelFile = modelPath.replace(dir, '');
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
						helper.setCurrentTaskValue(worldModelIndex++);

						let fileDataID;
						let fileName;

						try {
							if (usingNames) {
								fileName = objAdt.wmoNames[objAdt.wmoOffsets[model.mwidEntry]];
								fileDataID = await listfile.getByFilename(fileName);
							} else {
								fileDataID = model.mwidEntry;
								fileName = await listfile.getByID(fileDataID);
							}

							if (!isRawExport) {
								if (fileName !== undefined) {
									// Replace WMO extension with OBJ.
									fileName = ExportHelper.replaceExtension(fileName, '_set' + model.doodadSet + '.obj');
								} else {
									// Handle unknown WMO files.
									fileName = listfile.formatUnknownFile(fileDataID, '_set' + model.doodadSet + '.obj');
								}
							}

							let modelPath;
							if (config.enableSharedChildren)
								modelPath = ExportHelper.getExportPath(fileName);
							else
								modelPath = dir + '/' + fileName.split('/').pop();

							const doodadSets = useADTSets ? objAdt.doodadSets : [model.doodadSet];
							const cacheID = fileDataID + '-' + doodadSets.join(',');

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
										mask[model.doodadSet] = { checked: true };
									}
									
									wmoLoader.setDoodadSetMask(mask);
								}

								if (isRawExport)
									await wmoLoader.exportRaw(modelPath, helper);
								else
									await wmoLoader.exportAsOBJ(modelPath, helper);

								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								objectCache.add(cacheID);
							}

							const doodadNames = setNameCache.get(fileDataID);

							let modelFile = modelPath.replace(dir, '');
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
			const liquidFile = dir + '/' + 'liquid_' + this.tileID + '.json';
			log.write('Exporting liquid data to %s', liquidFile);

			const enhancedLiquidChunks = rootAdt.liquidChunks.map((chunk, chunkIndex) => {
				if (!chunk || !chunk.instances)
					return chunk;

				const terrainChunk = rootAdt.chunks[chunkIndex];
				const enhancedInstances = chunk.instances.map(instance => {
					if (!instance) return instance;

					const chunkX = terrainChunk.position[0];
					const chunkY = terrainChunk.position[1]; 
					const chunkZ = terrainChunk.position[2];

					const centerX = instance.xOffset + instance.width / 2;
					const centerY = instance.yOffset + instance.height / 2;
					
					const worldX = chunkY - (centerX * UNIT_SIZE);
					const worldY = (instance.minHeightLevel + instance.maxHeightLevel) / 2 + chunkZ;
					const worldZ = chunkX - (centerY * UNIT_SIZE);

					return {
						...instance,
						worldPosition: [worldX, worldY, worldZ],
						terrainChunkPosition: [chunkX, chunkY, chunkZ]
					};
				});

				return {
					...chunk,
					instances: enhancedInstances
				};
			});

			const liquidJSON = new JSONWriter(liquidFile);
			liquidJSON.addProperty('liquidChunks', enhancedLiquidChunks);
			await liquidJSON.write();
		}

		// Prepare foliage data tables if needed.
		if (config.mapsIncludeFoliage && !hasLoadedFoliage)
			await loadFoliageTables();

		// Export foliage.
		if (config.mapsIncludeFoliage && isFoliageAvailable) {
			const foliageExportCache = new Set();
			const foliageEffectCache = new Set();
			const foliageDir = dir + '/' + 'foliage';
			
			log.write('Exporting foliage to %s', foliageDir);

			for (const chunk of texAdt.texChunks) {
				// Skip chunks that have no layers?
				if (!chunk.layers)
					continue;

				for (const layer of chunk.layers) {
					// Skip layers with no effect.
					if (!layer.effectID)
						continue;

					const groundEffectTexture = await db.get_row('GroundEffectTexture', layer.effectID);
					if (!groundEffectTexture || !Array.isArray(groundEffectTexture.DoodadID))
						continue;

					// Create a foliage metadata JSON packed with the table data.
					let foliageJSON;
					if (core.view.config.exportFoliageMeta && !foliageEffectCache.has(layer.effectID)) {
						foliageJSON = new JSONWriter(foliageDir + '/' + layer.effectID + '.json');
						foliageJSON.data = groundEffectTexture;

						foliageEffectCache.add(layer.effectID);
					}

					const doodadModelIDs = {};
					for (const doodadEntryID of groundEffectTexture.DoodadID) {
						// Skip empty fields.
						if (!doodadEntryID)
							continue;

						const groundEffectDoodad = await db.get_row('GroundEffectDoodad', doodadEntryID);
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
							const fileName = await listfile.getByID(entry.fileDataID);

							if (isRawExport)
								entry.fileName = fileName.split('/').pop();
							else
								entry.fileName = ExportHelper.replaceExtension(fileName.split('/').pop(), '.obj');
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
				
				const modelName = (await listfile.getByID(modelID)).split('/').pop();
				
				const data = await casc.getFile(modelID);
				const m2 = new M2Exporter(data, undefined, modelID);

				if (isRawExport) {
					await m2.exportRaw(foliageDir + '/' + modelName, helper);
				} else {
					const modelPath = ExportHelper.replaceExtension(modelName, '.obj');
					await m2.exportAsOBJ(foliageDir + '/' + modelPath, config.modelsExportCollision, helper);
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

export default ADTExporter;