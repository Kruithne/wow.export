/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import util from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import { fileExists } from '../../generics';
import Constants from '../../constants';
import Listfile from '../../casc/listfile';
import Log from '../../log';
import BufferWrapper, { canvasToBuffer } from '../../buffer';
import BLPFile from '../../casc/blp';
import State from '../../state';
import RGBA from '../RGBA';

import WDTLoader from '../loaders/WDTLoader';
import ADTLoader from '../loaders/ADTLoader';

import OBJWriter from '../writers/OBJWriter';
import MTLWriter from '../writers/MTLWriter';

import WDCReader from '../../db/WDCReader';

import ExportHelper from '../../casc/export-helper';
import M2Exporter from '../../3D/exporters/M2Exporter';
import WMOExporter from '../../3D/exporters/WMOExporter';
import CSVWriter from '../../3D/writers/CSVWriter';
import JSONWriter from '../../3D/writers/JSONWriter';

import GameObjects from '../../db/types/GameObjects';

import GroundEffectTexture from '../../db/types/GroundEffectTexture';
import GroundEffectDoodad from '../../db/types/GroundEffectDoodad';

type ADTMaterial = {
	scale: number,
	fileDataID: number,
	file?: string,
	heightFile?: string,
	heightFileDataID?: number,
	heightScale?: number,
	heightOffset?: number,
	heightTex?: WebGLTexture,
	diffuseTex?: WebGLTexture,
}

type DoodadEntry = {
	fileDataID: number,
	fileName?: string
}

const MAP_SIZE = Constants.GAME.MAP_SIZE;
const TILE_SIZE = Constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const wdtCache = new Map();

const FRAG_SHADER_SRC = path.join(Constants.SHADER_PATH, 'adt.fragment.shader');
const FRAG_SHADER_OLD_SRC = path.join(Constants.SHADER_PATH, 'adt.fragment.old.shader');
const VERT_SHADER_SRC = path.join(Constants.SHADER_PATH, 'adt.vertex.shader');

let isFoliageAvailable = false;
let hasLoadedFoliage = false;
let dbTextures: WDCReader;
let dbDoodads: WDCReader;

let glShaderProg: WebGLProgram;
let glCanvas: HTMLCanvasElement;
let gl: WebGLRenderingContext;

/**
 * Load a texture from CASC and bind it to the GL context.
 * @param fileDataID - The fileDataID of the texture to load.
 * @returns The texture object or null if the texture could not be bound.
 */
async function loadTexture(fileDataID: number): Promise<WebGLTexture | null> {
	const texture = gl.createTexture();
	const blp = new BLPFile(await State.state.casc.getFile(fileDataID));

	gl.bindTexture(gl.TEXTURE_2D, texture);

	// For unknown reasons, we have to store blpData as a variable. Inlining it into the
	// parameter list causes issues, despite it being synchronous.
	const blpData = blp.toUInt8Array(0);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, blp.scaledWidth, blp.scaledHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, blpData);
	gl.generateMipmap(gl.TEXTURE_2D);

	return texture;
}

/** Load and cache GroundEffectDoodad and GroundEffectTexture data tables. */
async function loadFoliageTables(): Promise<void> {
	if (!hasLoadedFoliage) {
		try {
			dbDoodads = new WDCReader('DBFilesClient/GroundEffectDoodad.db2');
			dbTextures = new WDCReader('DBFilesClient/GroundEffectTexture.db2');

			await dbDoodads.parse();
			await dbTextures.parse();

			hasLoadedFoliage = true;
			isFoliageAvailable = true;
		} catch (e) {
			isFoliageAvailable = false;
			Log.write('Unable to load foliage tables, foliage exporting will be unavailable for all tiles.');
		}

		hasLoadedFoliage = true;
	}
}

/**
 * Bind an alpha layer to the GL context.
 * @param layer - The alpha layer to bind.
 * @returns The texture object or null if the texture could not be bound.
 */
function bindAlphaLayer(layer: Array<number>): WebGLTexture {
	const texture = gl.createTexture() as WebGLTexture;
	gl.bindTexture(gl.TEXTURE_2D, texture);

	const data = new Uint8Array(layer.length * 4);
	for (let i = 0, j = 0, n = layer.length; i < n; i++, j += 4)
		data[j + 0] = data[j + 1] = data[j + 2] = data[j + 3] = layer[i];

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.generateMipmap(gl.TEXTURE_2D);

	return texture;
}

/** Unbind all textures from the GL context. */
function unbindAllTextures(): void {
	// Unbind textures.
	for (let i = 0, n = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS); i < n; i++) {
		gl.activeTexture(gl.TEXTURE0 + i);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
}

/** Clear the canvas, resetting it to black. */
function clearCanvas(): void {
	gl.viewport(0, 0, glCanvas.width, glCanvas.height);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Convert an RGBA object into an integer.
 * @param rgba - The RGBA object to convert.
 * @returns The integer representation of the RGBA object.
 */
function rgbaToInt(rgba: RGBA): number {
	let intval = rgba.r;
	intval = (intval << 8) + rgba.g;
	intval = (intval << 8) + rgba.b;
	return (intval << 8) + rgba.a;
}

/**
 * Compile the vertex and fragment shaders used for baking.
 * @param useOld - Whether to use the old shader.
 */
async function compileShaders(useOld = false): Promise<void> {
	glShaderProg = gl.createProgram() as WebGLProgram;

	// Compile fragment shader.
	const fragShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
	gl.shaderSource(fragShader, await fs.promises.readFile(useOld ? FRAG_SHADER_OLD_SRC : FRAG_SHADER_SRC, 'utf8'));
	gl.compileShader(fragShader);

	if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
		Log.write('Fragment shader failed to compile: %s', gl.getShaderInfoLog(fragShader) as string);
		throw new Error('Failed to compile fragment shader');
	}

	// Compile vertex shader.
	const vertShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
	gl.shaderSource(vertShader, await fs.promises.readFile(VERT_SHADER_SRC, 'utf8'));
	gl.compileShader(vertShader);

	if (!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
		Log.write('Vertex shader failed to compile: %s', gl.getShaderInfoLog(vertShader) as string);
		throw new Error('Failed to compile vertex shader');
	}

	// Attach shaders.
	gl.attachShader(glShaderProg, fragShader);
	gl.attachShader(glShaderProg, vertShader);

	// Link program.
	gl.linkProgram(glShaderProg);
	if (!gl.getProgramParameter(glShaderProg, gl.LINK_STATUS)) {
		Log.write('Unable to link shader program: %s', gl.getProgramInfoLog(glShaderProg) as string);
		throw new Error('Failed to link shader program');
	}

	gl.useProgram(glShaderProg);
}

export default class ADTExporter {
	mapID: number;
	mapDir: string;
	tileX: number;
	tileY: number;
	tileID: string;
	tileIndex: number;

	/**
	 * Construct a new ADTLoader instance.
	 * @param mapID - The map ID of the tile.
	 * @param mapDir - The directory of the map.
	 * @param tileIndex - The tile index of the tile.
	 */
	constructor(mapID: number, mapDir: string, tileIndex: number) {
		this.mapID = mapID;
		this.mapDir = mapDir;
		this.tileX = tileIndex % MAP_SIZE;
		this.tileY = Math.floor(tileIndex / MAP_SIZE);
		this.tileID = this.tileY + '_' + this.tileX;
		this.tileIndex = tileIndex;
	}

	/**
	 * Export the ADT tile.
	 * @param dir - Directory to export the tile into.
	 * @param quality - The quality of the exported tile.
	 * @param gameObjects - Additional game objects to export.
	 * @param helper
	 * @returns The path to the exported tile.
	 */
	async export(dir: string, quality: number, gameObjects: Set<GameObjects>, helper: ExportHelper): Promise<{ type: string; path: string }> {
		const casc = State.state.casc;
		const config = State.state.config;

		const out = { type: config.mapsExportRaw ? 'ADT_RAW' : 'ADT_OBJ', path: '' };

		const usePosix = config.pathFormat === 'posix';
		const prefix = util.format('world/maps/%s/%s', this.mapDir, this.mapDir);

		// Load the WDT. We cache this to speed up exporting large amounts of tiles
		// from the same map. Make sure ADTLoader.clearCache() is called after exporting.
		let wdt = wdtCache.get(this.mapDir);
		if (!wdt) {
			const wdtFile = await casc.getFileByName(prefix + '.wdt');
			if (config.mapsExportRaw)
				await wdtFile.writeToFile(path.join(dir, this.mapDir + '.wdt'));

			wdt = new WDTLoader(wdtFile);
			await wdt.load();
			wdtCache.set(this.mapDir, wdt);
		}

		console.log(wdt);
		const tilePrefix = prefix + '_' + this.tileID;

		const maid = wdt.entries[this.tileIndex];
		const rootFileDataID = maid.rootADT > 0 ? maid.rootADT : Listfile.getByFilename(tilePrefix + '.adt');
		const tex0FileDataID = maid.tex0ADT > 0 ? maid.tex0ADT : Listfile.getByFilename(tilePrefix + '_obj0.adt');
		const obj0FileDataID = maid.obj0ADT > 0 ? maid.obj0ADT : Listfile.getByFilename(tilePrefix + '_tex0.adt');

		// Ensure we actually have the fileDataIDs for the files we need.
		if (rootFileDataID === 0 || tex0FileDataID === 0 || obj0FileDataID === 0)
			throw new Error('Missing fileDataID for ADT files: ' + [rootFileDataID, tex0FileDataID, obj0FileDataID].join(', '));

		const rootFile = await casc.getFile(rootFileDataID);
		const texFile = await casc.getFile(tex0FileDataID);
		const objFile = await casc.getFile(obj0FileDataID);

		if (config.mapsExportRaw) {
			await rootFile.writeToFile(path.join(dir, this.tileID + '.adt'));
			await texFile.writeToFile(path.join(dir, this.tileID + '_tex0.adt'));
			await objFile.writeToFile(path.join(dir, this.tileID + '_obj0.adt'));
		}

		const rootAdt = new ADTLoader(rootFile);
		rootAdt.loadRoot();

		const texAdt = new ADTLoader(texFile);
		texAdt.loadTex(wdt);

		const objAdt = new ADTLoader(objFile);
		objAdt.loadObj();

		if (config.mapsExportRaw) {
			//
		} else {
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
			const isSplittingAlphaMaps = isAlphaMaps && State.state.config.splitAlphaMaps;
			const isSplittingTextures = isLargeBake && State.state.config.splitLargeTerrainBakes;
			const includeHoles = State.state.config.mapsIncludeHoles;

			let ofs = 0;
			let chunkID = 0;
			for (let x = 0, midX = 0; x < 16; x++) {
				for (let y = 0; y < 16; y++) {
					const indices = Array<number>();

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
							const vy = chunk.vertices[idx] + chunkZ;
							const vz = chunkX - (row * UNIT_SIZE_HALF);

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
						obj.addMesh(chunkID.toString(), indices, 'tex_' + this.tileID);
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
					if (ctx === null)
						throw new Error('Failed to create canvas context.');

					const materialIDs = texAdt.diffuseTextureFileDataIDs;
					const heightIDs = texAdt.heightTextureFileDataIDs;
					const texParams = texAdt.texParams;

					const saveLayerTexture = async (fileDataID: number): Promise<string> => {
						const blp = new BLPFile(await State.state.casc.getFile(fileDataID));
						let fileName = Listfile.getByID(fileDataID);
						if (fileName !== undefined)
							fileName = ExportHelper.replaceExtension(fileName, '.png');
						else
							fileName = Listfile.formatUnknownFile(fileDataID, '.png');

						let texFile: string;
						let texPath: string;

						if (config.enableSharedTextures) {
							texPath = ExportHelper.getExportPath(fileName);
							texFile = path.relative(dir, texPath);
						} else {
							texPath = path.join(dir, path.basename(fileName));
							texFile = path.basename(texPath);
						}

						await blp.toPNG().writeToFile(texPath);

						return usePosix ? ExportHelper.win32ToPosix(texFile) : texFile;
					};

					// Export the raw diffuse textures to disk.
					const materials = new Array(materialIDs.length);
					for (let i = 0, n = materials.length; i < n; i++) {
						// Abort if the export has been cancelled.
						if (helper.isCancelled())
							return { type: '', path: '' };

						const diffuseFileDataID = materialIDs[i];
						const heightFileDataID = heightIDs[i] ?? 0;
						if (diffuseFileDataID === 0)
							continue;

						const mat = materials[i] = {
							scale: 1,
							fileDataID: diffuseFileDataID
						} as ADTMaterial;

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
							return { type: '', path: '' };

						helper.setCurrentTaskValue(chunkIndex);

						const texChunk = texAdt.texChunks[chunkIndex];
						const rootChunk = rootAdt.chunks[chunkIndex];

						const alphaLayers = texChunk.alphaLayers || [];
						const imageData = ctx.createImageData(64, 64);

						// Write each layer as RGB.
						for (let i = 1; i < alphaLayers.length; i++) {
							const layer = alphaLayers[i];

							for (let j = 0; j < layer.length; j++)
								imageData.data[(j * 4) + (i - 1)] = layer[j];
						}

						// Set all the alpha values to max.
						for (let i = 0; i < 64 * 64; i++)
							imageData.data[(i * 4) + 3] = 255;

						if (isSplittingAlphaMaps) {
							// Export tile as an individual file.
							ctx.putImageData(imageData, 0, 0);

							const prefix = this.tileID + '_' + chunkIndex;
							const tilePath = path.join(dir, 'tex_' + prefix + '.png');

							const buf = new BufferWrapper(await canvasToBuffer(canvas, 'image/png'));
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
						const buf = new BufferWrapper(await canvasToBuffer(canvas, 'image/png'));
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

					if (config.overwriteFiles || !await fileExists(tileOutPath)) {
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
						if (ctx === null)
							throw new Error('Failed to get canvas context');

						ctx.scale(scale, scale);
						ctx.drawImage(canvas, 0, 0);

						const buf = new BufferWrapper(await canvasToBuffer(scaled, 'image/png'));
						await buf.writeToFile(tileOutPath);
					} else {
						Log.write('Skipping ADT bake of %s (file exists, overwrite disabled)', tileOutPath);
					}
				} else {
					const hasHeightTexturing = (wdt.flags & 0x80) === 0x80;
					const tileOutPath = path.join(dir, 'tex_' + this.tileID + '.png');

					let composite, compositeCtx;
					if (!isSplittingTextures) {
						composite = new OffscreenCanvas(quality, quality);
						compositeCtx = composite.getContext('2d');
					}

					if (isSplittingTextures || config.overwriteFiles || !await fileExists(tileOutPath)) {
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

							const mat = materials[i] = { scale: 1, heightScale: 0, heightOffset: 1 } as ADTMaterial;
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

						if (rotateCtx === null)
							throw new Error('Failed to create rotation canvas.');

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
									return { path: '', type: '' };

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
								const heightScales = new Array<number>(4).fill(1);
								const heightOffsets = new Array<number>(4).fill(1);

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
									gl.uniform4f(uHeightScale, ...heightScales as [number, number, number, number]);
									gl.uniform4f(uHeightOffset, ...heightOffsets as [number, number, number, number]);
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

									if (config.overwriteFiles || !await fileExists(tilePath)) {
										rotateCtx.drawImage(glCanvas, -(rotateCanvas.width / 2), -(rotateCanvas.height / 2));

										const buf = new BufferWrapper(await canvasToBuffer(rotateCanvas, 'image/png'));
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
							const buf = new BufferWrapper(await canvasToBuffer(composite, 'image/png'));
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
		}

		// Export dooads / WMOs.
		if (config.mapsIncludeWMO || config.mapsIncludeM2 || config.mapsIncludeGameObjects) {
			const objectCache = new Set();

			const csvPath = path.join(dir, 'adt_' + this.tileID + '_ModelPlacementInformation.csv');
			if (config.overwriteFiles || !await fileExists(csvPath)) {
				const csv = new CSVWriter(csvPath);
				csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationX', 'RotationY', 'RotationZ', 'RotationW', 'ScaleFactor', 'ModelId', 'Type', 'FileDataID', 'DoodadSetIndexes', 'DoodadSetNames');

				const exportObjects = async (exportType: string, objects, csvName: string): Promise<void> => {
					const nObjects = objects?.length ?? objects.size;
					Log.write('Exporting %d %s for ADT...', nObjects, exportType);

					helper.setCurrentTaskName('Tile ' + this.tileID + ', ' + exportType);
					helper.setCurrentTaskMax(nObjects);

					let index = 0;
					for (const model of objects) {
						helper.setCurrentTaskValue(index++);

						const fileDataID = model.FileDataID ?? model.mmidEntry;
						let fileName = Listfile.getByID(fileDataID);

						if (!config.mapsExportRaw) {
							if (fileName !== undefined) {
								// Replace M2 extension with OBJ.
								fileName = ExportHelper.replaceExtension(fileName, '.obj');
							} else {
								// Handle unknown file.
								fileName = Listfile.formatUnknownFile(fileDataID, '.obj');
							}
						}

						let modelPath: string;
						if (config.enableSharedChildren)
							modelPath = ExportHelper.getExportPath(fileName as string);
						else
							modelPath = path.join(dir, path.basename(fileName as string));

						try {
							if (!objectCache.has(fileDataID)) {
								const data = await casc.getFile(fileDataID);
								const m2 = new M2Exporter(data, undefined, fileDataID);

								if (config.mapsExportRaw)
									await m2.exportRaw(modelPath, helper);
								else
									await m2.exportAsOBJ(modelPath, false, helper);

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
							Log.write('Failed to export %s [%d]', fileName, fileDataID);
							Log.write('Error: %s', e);
						}
					}
				};

				if (config.mapsIncludeGameObjects === true && gameObjects !== undefined && gameObjects.size > 0)
					await exportObjects('game objects', gameObjects, 'gobj');

				if (config.mapsIncludeM2)
					await exportObjects('doodads', objAdt.models, 'm2');

				if (config.mapsIncludeWMO && objAdt.worldModels !== undefined) {
					Log.write('Exporting %d WMOs for ADT...', objAdt.worldModels.length);

					helper.setCurrentTaskName('Tile ' + this.tileID + ', WMO objects');
					helper.setCurrentTaskMax(objAdt.worldModels.length);

					const setNameCache = new Map();

					let worldModelIndex = 0;
					const usingNames = !!objAdt.wmoNames;
					for (const model of objAdt.worldModels) {
						const useADTSets = model.flags & 0x80;
						helper.setCurrentTaskValue(worldModelIndex++);

						let fileDataID: number | undefined;
						let fileName: string | undefined;

						try {
							if (usingNames) {
								fileName = objAdt.wmoNames[objAdt.wmoOffsets[model.mwidEntry]];
								fileDataID = Listfile.getByFilename(fileName);
							} else {
								fileDataID = model.mwidEntry;
								fileName = Listfile.getByID(fileDataID);
							}

							if (fileDataID === undefined)
								throw new Error('Missing FileDataID for WMO export');

							if (!config.mapsExportRaw) {
								if (fileName !== undefined) {
									// Replace WMO extension with OBJ.
									fileName = ExportHelper.replaceExtension(fileName, '_set' + model.doodadSet + '.obj');
								} else {
									// Handle unknown WMO files.
									fileName = Listfile.formatUnknownFile(fileDataID, '_set' + model.doodadSet + '.obj');
								}
							}

							let modelPath: string;
							if (config.enableSharedChildren)
								modelPath = ExportHelper.getExportPath(fileName);
							else
								modelPath = path.join(dir, path.basename(fileName));

							const doodadSets = useADTSets ? objAdt.doodadSets : [model.doodadSet];
							const cacheID = fileDataID + '-' + doodadSets.join(',');

							if (!objectCache.has(cacheID)) {
								const data = await casc.getFile(fileDataID);
								const wmoLoader = new WMOExporter(data, fileDataID);

								await wmoLoader.wmo.load();

								setNameCache.set(fileDataID, wmoLoader.wmo.doodadSets.map(e => e.name));

								if (config.mapsIncludeWMOSets) {
									const mask = [];
									mask[0] = { checked: true, label: '', index: 0 };
									if (useADTSets) {
										for (const setIndex of objAdt.doodadSets)
											mask[setIndex] = { checked: true, label: '', index: 0 };
									} else {
										mask[model.doodadSet] = { checked: true, label: '', index: 0 };
									}

									wmoLoader.setDoodadSetMask(mask);
								}

								if (config.mapsExportRaw)
									await wmoLoader.exportRaw(modelPath, helper);
								else
									await wmoLoader.exportAsOBJ(modelPath, helper);

								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return { path: '', type: '' };

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
							Log.write('Failed to export %s [%d]', fileName, fileDataID);
							Log.write('Error: %s', e);
						}
					}
				}

				await csv.write();
			} else {
				Log.write('Skipping model placement export %s (file exists, overwrite disabled)', csvPath);
			}
		}

		// Export liquids.
		if (config.mapsIncludeLiquid && rootAdt.liquidChunks) {
			const liquidFile = path.join(dir, 'liquid_' + this.tileID + '.json');
			Log.write('Exporting liquid data to %s', liquidFile);

			const liquidJSON = new JSONWriter(liquidFile);
			liquidJSON.addProperty('liquidChunks', rootAdt.liquidChunks);
			await liquidJSON.write();
		}

		// Prepare foliage data tables if needed.
		if (config.mapsIncludeFoliage && !hasLoadedFoliage)
			await loadFoliageTables();

		// Export foliage.
		if (config.mapsIncludeFoliage && isFoliageAvailable) {
			const foliageExportCache = new Set<number>();
			const foliageEffectCache = new Set<number>();
			const foliageDir = path.join(dir, 'foliage');

			Log.write('Exporting foliage to %s', foliageDir);

			for (const chunk of texAdt.texChunks) {
				// Skip chunks that have no layers?
				if (!chunk.layers)
					continue;

				for (const layer of chunk.layers) {
					// Skip layers with no effect.
					if (!layer.effectID)
						continue;

					const groundEffectTexture = dbTextures.getRow(layer.effectID) as GroundEffectTexture;
					if (!groundEffectTexture || !Array.isArray(groundEffectTexture.DoodadID))
						continue;

					// Create a foliage metadata JSON packed with the table data.
					let foliageJSON;
					if (State.state.config.exportFoliageMeta && !foliageEffectCache.has(layer.effectID)) {
						foliageJSON = new JSONWriter(path.join(foliageDir, layer.effectID + '.json'));
						foliageJSON.data = groundEffectTexture;

						foliageEffectCache.add(layer.effectID);
					}

					const doodadModelIDs = {} as { [key: number]: DoodadEntry };
					for (const doodadEntryID of groundEffectTexture.DoodadID) {
						// Skip empty fields.
						if (!doodadEntryID)
							continue;

						const groundEffectDoodad = dbDoodads.getRow(doodadEntryID) as GroundEffectDoodad;
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
							const fileName = Listfile.getByID(entry.fileDataID);

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

				const modelName = path.basename(Listfile.getByID(modelID));

				const data = await casc.getFile(modelID);
				const m2 = new M2Exporter(data, undefined, modelID);

				if (config.mapsExportRaw) {
					await m2.exportRaw(path.join(foliageDir, modelName), helper);
				} else {
					const modelPath = ExportHelper.replaceExtension(modelName, '.obj');
					await m2.exportAsOBJ(path.join(foliageDir, modelPath), false, helper);
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
	static clearCache(): void {
		wdtCache.clear();
	}
}