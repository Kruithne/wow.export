/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const crypto = require('crypto');
const core = require('../core');
const log = require('../log');
const path = require('path');
const listfile = require('../casc/listfile');
const constants = require('../constants');

const WDCReader = require('../db/WDCReader');
const BLPFile = require('../casc/blp');
const WDTLoader = require('../3D/loaders/WDTLoader');
const ADTExporter = require('../3D/exporters/ADTExporter');
const ADTLoader = require('../3D/loaders/ADTLoader');
const ExportHelper = require('../casc/export-helper');
const WMOExporter = require('../3D/exporters/WMOExporter');
const TiledPNGWriter = require('../tiled-png-writer');
const PNGWriter = require('../png-writer');

let selectedMapID;
let selectedMapDir;
let selectedWDT;

const TILE_SIZE = constants.GAME.TILE_SIZE;
const MAP_OFFSET = constants.GAME.MAP_OFFSET;

let gameObjectsDB2 = null;

/**
 * Load a map into the map viewer.
 * @param {number} mapID 
 * @param {string} mapDir 
 */
const loadMap = async (mapID, mapDir) => {
	const mapDirLower = mapDir.toLowerCase();

	selectedMapID = mapID;
	selectedMapDir = mapDirLower;

	selectedWDT = null;
	core.view.mapViewerHasWorldModel = false;

	// Attempt to load the WDT for this map for chunk masking.
	const wdtPath = util.format('world/maps/%s/%s.wdt', mapDirLower, mapDirLower);
	log.write('Loading map preview for %s (%d)', mapDirLower, mapID);

	try {
		const data = await core.view.casc.getFileByName(wdtPath);
		const wdt = selectedWDT = new WDTLoader(data);
		wdt.load();

		// Enable the 'Export Global WMO' button if available.
		if (wdt.worldModelPlacement)
			core.view.mapViewerHasWorldModel = true;

		core.view.mapViewerChunkMask = wdt.tiles;

		// check if map has no terrain tiles but has global wmo
		const has_terrain = wdt.tiles && wdt.tiles.some(tile => tile === 1);
		const has_global_wmo = wdt.worldModelPlacement !== undefined;

		if (!has_terrain && has_global_wmo)
			core.setToast('info', 'This map has no terrain tiles. Use "Export Global WMO" to export the world model.', null, 6000);
	} catch (e) {
		// Unable to load WDT, default to all chunks enabled.
		log.write('Cannot load %s, defaulting to all chunks enabled', wdtPath);
		core.view.mapViewerChunkMask = null;
	}

	// Reset the tile selection.
	core.view.mapViewerSelection.splice(0);

	// While not used directly by the components, we update this reactive value
	// so that the components know a new map has been selected, and to request tiles.
	core.view.mapViewerSelectedMap = mapID;

	// Purposely provide the raw mapDir here as it's used by the external link module
	// and wow.tools requires a properly cased map name.
	core.view.mapViewerSelectedDir = mapDir;
};

/**
 * Load a map tile.
 * @param {number} x 
 * @param {number} y 
 * @param {number} size 
 */
const loadMapTile = async (x, y, size) => {
	// If no map has been selected, abort.
	if (!selectedMapDir)
		return false;

	try {
		// Attempt to load the requested tile from CASC.
		const paddedX = x.toString().padStart(2, '0');
		const paddedY = y.toString().padStart(2, '0');
		const tilePath = util.format('world/minimaps/%s/map%s_%s.blp', selectedMapDir, paddedX, paddedY);
		const data = await core.view.casc.getFileByName(tilePath, false, true);
		const blp = new BLPFile(data);

		// Draw the BLP onto a raw-sized canvas.
		const canvas = blp.toCanvas(0b0111);

		// Scale the image down by copying the raw canvas onto a
		// scaled canvas, and then returning the scaled image data.
		const scale = size / blp.scaledWidth;
		const scaled = document.createElement('canvas');
		scaled.width = size;
		scaled.height = size;

		const ctx = scaled.getContext('2d');
		ctx.scale(scale, scale);
		ctx.drawImage(canvas, 0, 0);
		
		return ctx.getImageData(0, 0, size, size);
	} catch (e) {
		// Map tile does not exist or cannot be read.
		return false;
	}
};

/**
 * Collect game objects from GameObjects.db2 for export.
 * @param {number} mapID
 * @param {function} filter
 */
const collectGameObjects = async (mapID, filter) => {
	// Load GameObjects.db2/GameObjectDisplayInfo.db2 on-demand.
	if (gameObjectsDB2 === null) {
		const objTable = new WDCReader('DBFilesClient/GameObjects.db2');
		await objTable.parse();

		const idTable = new WDCReader('DBFilesClient/GameObjectDisplayInfo.db2');
		await idTable.parse();

		// Index all of the rows by the map ID.
		gameObjectsDB2 = new Map();
		for (const row of objTable.getAllRows().values()) {
			// Look-up the fileDataID ahead of time.
			const fidRow = idTable.getRow(row.DisplayID);
			if (fidRow !== null) {
				row.FileDataID = fidRow.FileDataID;

				let map = gameObjectsDB2.get(row.OwnerID);
				if (map === undefined) {
					map = new Set();
					map.add(row);
					gameObjectsDB2.set(row.OwnerID, map);
				} else {
					map.add(row);
				}
			}
		}
	}

	const result = new Set();
	const mapObjects = gameObjectsDB2.get(mapID);

	if (mapObjects !== undefined) {
		for (const obj of mapObjects) {
			if (filter !== undefined && filter(obj))
				result.add(obj);
		}
	}

	return result;
};

const exportSelectedMapWMO = async () => {
	const helper = new ExportHelper(1, 'WMO');
	helper.start();

	try {
		if (!selectedWDT || !selectedWDT.worldModelPlacement)
			throw new Error('Map does not contain a world model.');

		const placement = selectedWDT.worldModelPlacement;
		let fileDataID = 0;
		let fileName;

		if (selectedWDT.worldModel) {
			fileName = selectedWDT.worldModel;
			fileDataID = listfile.getByFilename(fileName);

			if (!fileDataID)
				throw new Error('Invalid world model path: ' + fileName);
		} else {
			if (placement.id === 0)
				throw new Error('Map does not define a valid world model.');
			
			fileDataID = placement.id;
			fileName = listfile.getByID(fileDataID) || 'unknown_' + fileDataID + '.wmo';
		}

		const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), '.obj');

		const data = await core.view.casc.getFile(fileDataID);
		const wmo = new WMOExporter(data, fileDataID);

		wmo.setDoodadSetMask({ [placement.doodadSetIndex]: { checked: true } });
		await wmo.exportAsOBJ(exportPath, helper);

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		helper.mark(fileName, true);
	} catch (e) {
		helper.mark('world model', false, e.message, e.stack);
	}

	WMOExporter.clearCache();

	helper.finish();
};

const exportSelectedMap = async () => {
	const exportTiles = core.view.mapViewerSelection;
	const exportQuality = core.view.config.exportMapQuality;

	// User has not selected any tiles.
	if (exportTiles.length === 0)
		return core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

	const helper = new ExportHelper(exportTiles.length, 'tile');
	helper.start();

	const dir = ExportHelper.getExportPath(path.join('maps', selectedMapDir));

	const exportPaths = core.openLastExportStream();

	// The export helper provides the user with a link to the directory of the last exported
	// item. Since we're using directory paths, we just append another segment here so that
	// when the path is trimmed, users end up in the right place. Bit hack-y, but quicker.
	const markPath = path.join('maps', selectedMapDir, selectedMapDir);

	for (const index of exportTiles) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			break;

		const adt = new ADTExporter(selectedMapID, selectedMapDir, index);

		// Locate game objects within the tile for exporting.
		let gameObjects = undefined;
		if (core.view.config.mapsIncludeGameObjects === true) {
			const startX = MAP_OFFSET - (adt.tileX * TILE_SIZE) - TILE_SIZE;
			const startY = MAP_OFFSET - (adt.tileY * TILE_SIZE) - TILE_SIZE;
			const endX = startX + TILE_SIZE;
			const endY = startY + TILE_SIZE;

			gameObjects = await collectGameObjects(selectedMapID, obj => {
				const [posX, posY] = obj.Pos;
				return posX > startX && posX < endX && posY > startY && posY < endY;
			});
		}

		try {
			const out = await adt.export(dir, exportQuality, gameObjects, helper);
			await exportPaths?.writeLine(out.type + ':' + out.path);
			helper.mark(markPath, true);
		} catch (e) {
			helper.mark(markPath, false, e.message, e.stack);
		}
	}

	exportPaths?.close();
	ADTExporter.clearCache();
	helper.finish();
};

const exportSelectedMapAsRaw = async () => {
	const exportTiles = core.view.mapViewerSelection;

	if (exportTiles.length === 0)
		return core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

	const helper = new ExportHelper(exportTiles.length, 'tile');
	helper.start();

	const dir = ExportHelper.getExportPath(path.join('maps', selectedMapDir));
	const exportPaths = core.openLastExportStream();
	const markPath = path.join('maps', selectedMapDir, selectedMapDir);

	for (const index of exportTiles) {
		if (helper.isCancelled())
			break;

		const adt = new ADTExporter(selectedMapID, selectedMapDir, index);

		try {
			const out = await adt.export(dir, 0, undefined, helper);
			await exportPaths?.writeLine(out.type + ':' + out.path);
			helper.mark(markPath, true);
		} catch (e) {
			helper.mark(markPath, false, e.message, e.stack);
		}
	}

	exportPaths?.close();

	// Clear the internal ADTLoader cache.
	ADTExporter.clearCache();

	helper.finish();
};

const exportSelectedMapAsPNG = async () => {
	const export_tiles = core.view.mapViewerSelection;

	if (export_tiles.length === 0)
		return core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

	const helper = new ExportHelper(export_tiles.length + 1, 'tile');
	helper.start();

	try {
		const tile_coords = export_tiles.map(index => ({
			index,
			x: Math.floor(index / constants.GAME.MAP_SIZE),
			y: index % constants.GAME.MAP_SIZE
		}));

		const min_x = Math.min(...tile_coords.map(t => t.x));
		const max_x = Math.max(...tile_coords.map(t => t.x));
		const min_y = Math.min(...tile_coords.map(t => t.y));
		const max_y = Math.max(...tile_coords.map(t => t.y));

		const first_tile = await loadMapTile(tile_coords[0].x, tile_coords[0].y, 512);
		if (!first_tile)
			throw new Error('Unable to load first tile to determine tile size');

		const tile_size = first_tile.width;
		log.write('Detected tile size: %dx%d pixels', tile_size, tile_size);

		const tiles_wide = (max_x - min_x) + 1;
		const tiles_high = (max_y - min_y) + 1;
		const final_width = tiles_wide * tile_size;
		const final_height = tiles_high * tile_size;

		log.write('PNG canvas %dx%d pixels (%d x %d tiles)', final_width, final_height, tiles_wide, tiles_high);

		const writer = new TiledPNGWriter(final_width, final_height, tile_size);

		for (const tile_coord of tile_coords) {
			if (helper.isCancelled())
				break;

			const tile_data = await loadMapTile(tile_coord.x, tile_coord.y, tile_size);
			
			if (tile_data) {
				const rel_x = tile_coord.x - min_x;
				const rel_y = tile_coord.y - min_y;
				
				writer.addTile(rel_x, rel_y, tile_data);
				log.write('Added tile %d,%d at position %d,%d', tile_coord.x, tile_coord.y, rel_x, rel_y);
				helper.mark(`Tile ${tile_coord.x} ${tile_coord.y}`, true);
			} else {
				log.write('Failed to load tile %d,%d, leaving gap', tile_coord.x, tile_coord.y);
				helper.mark(`Tile ${tile_coord.x} ${tile_coord.y}`, false, 'Tile not available');
			}
		}

		const sorted_tiles = [...export_tiles].sort((a, b) => a - b);
		const tile_hash = crypto.createHash('md5').update(sorted_tiles.join(',')).digest('hex').substring(0, 8);
		
		const filename = `${selectedMapDir}_${tile_hash}.png`;
		const out_path = ExportHelper.getExportPath(path.join('maps', selectedMapDir, filename));

		await writer.write(out_path);

		const stats = writer.getStats();
		log.write('Map export complete: %s (%d tiles)', out_path, stats.totalTiles);
		
		const exportPaths = core.openLastExportStream();
		await exportPaths?.writeLine('png:' + out_path);
		exportPaths?.close();

		helper.mark(path.join('maps', selectedMapDir, filename), true);

	} catch (e) {
		helper.mark('PNG export', false, e.message, e.stack);
		log.write('PNG export failed: %s', e.message);
	}

	helper.finish();
};

const exportSelectedMapAsHeightmaps = async () => {
	const export_tiles = core.view.mapViewerSelection;
	const export_quality = core.view.config.exportMapQuality;

	if (export_tiles.length === 0)
		return core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

	if (export_quality <= 0)
		return core.setToast('error', 'Cannot export heightmaps with "None" texture quality selected.', null, -1);

	const dir = ExportHelper.getExportPath(path.join('maps', selectedMapDir, 'heightmaps'));
	const export_paths = core.openLastExportStream();

	core.setToast('progress', 'Calculating height range across all tiles...', null, -1, false);
	let global_min_height = Infinity;
	let global_max_height = -Infinity;

	for (let i = 0; i < export_tiles.length; i++) {
		const tile_index = export_tiles[i];

		try {
			const adt = new ADTExporter(selectedMapID, selectedMapDir, tile_index);
			const height_data = await extractHeightDataFromTile(adt, export_quality);
			
			if (height_data && height_data.heights) {
				let tile_min = Infinity;
				let tile_max = -Infinity;
				
				for (let j = 0; j < height_data.heights.length; j++) {
					const height = height_data.heights[j];
					if (height < tile_min)
						tile_min = height;

					if (height > tile_max)
						tile_max = height;
				}
				
				global_min_height = Math.min(global_min_height, tile_min);
				global_max_height = Math.max(global_max_height, tile_max);

				log.write('Tile %d: height range [%f, %f]', tile_index, tile_min, tile_max);
			}
		} catch (e) {
			log.write('Failed to extract height data from tile %d: %s', tile_index, e.message);
		}
	}

	if (global_min_height === Infinity || global_max_height === -Infinity) {
		core.hideToast();
		return core.setToast('error', 'No valid height data found in selected tiles', null, -1);
	}

	const height_range = global_max_height - global_min_height;
	log.write('Global height range: [%f, %f] (range: %f)', global_min_height, global_max_height, height_range);

	// Hide the calculation toast and start the export helper
	core.hideToast();
	
	const helper = new ExportHelper(export_tiles.length, 'heightmap');
	helper.start();
	
	for (let i = 0; i < export_tiles.length; i++) {
		const tile_index = export_tiles[i];

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			break;

		const tile_id = Math.floor(tile_index / constants.GAME.MAP_SIZE) + '_' + (tile_index % constants.GAME.MAP_SIZE);
		const filename = `heightmap_${tile_id}.png`;

		try {
			const adt = new ADTExporter(selectedMapID, selectedMapDir, tile_index);
			const height_data = await extractHeightDataFromTile(adt, export_quality);

			if (!height_data || !height_data.heights) {
				helper.mark(`heightmap_${tile_id}.png`, false, 'No height data available');
				continue;
			}

			const out_path = path.join(dir, filename);

			const writer = new PNGWriter(export_quality, export_quality);
			if (core.view.config.heightmap32BitDepth) {
				writer.bytesPerPixel = 4;
				writer.bitDepth = 8;
				writer.colorType = 6; // RGBA
				
				const pixel_data = writer.getPixelData();
				
				for (let j = 0; j < height_data.heights.length; j++) {
					const normalized_height = (height_data.heights[j] - global_min_height) / height_range;
					const float_buffer = new ArrayBuffer(4);
					const float_view = new Float32Array(float_buffer);
					const byte_view = new Uint8Array(float_buffer);
					float_view[0] = normalized_height;
					
					const pixel_offset = j * 4;
					pixel_data[pixel_offset] = byte_view[0]; // R
					pixel_data[pixel_offset + 1] = byte_view[1]; // G  
					pixel_data[pixel_offset + 2] = byte_view[2]; // B
					pixel_data[pixel_offset + 3] = byte_view[3]; // A
				}
			} else {
				writer.bytesPerPixel = 2;
				writer.bitDepth = 16;
				writer.colorType = 0; // Grayscale
				
				const pixel_data = writer.getPixelData();
				
				for (let j = 0; j < height_data.heights.length; j++) {
					const normalized_height = (height_data.heights[j] - global_min_height) / height_range;
					const gray_value = Math.floor(normalized_height * 65535);
					const pixel_offset = j * 2;
					
					pixel_data[pixel_offset] = (gray_value >> 8) & 0xFF;
					pixel_data[pixel_offset + 1] = gray_value & 0xFF;
				}
			}
			
			await writer.write(out_path);

			await export_paths?.writeLine('png:' + out_path);
			
			helper.mark(path.join('maps', selectedMapDir, 'heightmaps', filename), true);
			log.write('Exported heightmap: %s', out_path);

		} catch (e) {
			helper.mark(filename, false, e.message, e.stack);
			log.write('Failed to export heightmap for tile %d: %s', tile_index, e.message);
		}
	}

	export_paths?.close();
	helper.finish();
};

/**
 * Sample height at a specific position within a chunk using bilinear interpolation.
 * @param {Object} chunk - Chunk data with vertices array
 * @param {number} localX - X position within chunk (0-1 range)
 * @param {number} localY - Y position within chunk (0-1 range)
 * @returns {number} - Interpolated height value
 */
const sampleChunkHeight = (chunk, localX, localY) => {
	// local -> vertex
	const vx = localX * 8; // 8 units across chunk
	const vy = localY * 8; // 8 units down chunk
	
	// get surrounding
	const x0 = Math.floor(vx);
	const y0 = Math.floor(vy);
	const x1 = Math.min(8, x0 + 1);
	const y1 = Math.min(8, y0 + 1);
	
	// vertex indices using 17x17 alternating pattern
	const get_vert_idx = (x, y) => {
		let index = 0;
		for (let row = 0; row < y * 2; row++)
			index += (row % 2) ? 8 : 9;

		const is_short = !!(y * 2 % 2);
		index += is_short ? Math.min(x, 7) : Math.min(x, 8);
		return index;
	};
	
	// corners
	const h00 = chunk.vertices[get_vert_idx(x0, y0)] + chunk.position[2];
	const h10 = chunk.vertices[get_vert_idx(x1, y0)] + chunk.position[2];
	const h01 = chunk.vertices[get_vert_idx(x0, y1)] + chunk.position[2];
	const h11 = chunk.vertices[get_vert_idx(x1, y1)] + chunk.position[2];
	
	// bilinear interpolation
	const fx = vx - x0;
	const fy = vy - y0;
	
	const h0 = h00 * (1 - fx) + h10 * fx;
	const h1 = h01 * (1 - fx) + h11 * fx;
	
	return h0 * (1 - fy) + h1 * fy;
};

/**
 * Extract height data from a terrain tile.
 * @param {ADTExporter} adt 
 * @param {number} resolution 
 * @returns {Object|null}
 */
const extractHeightDataFromTile = async (adt, resolution) => {
	const map_dir = adt.mapDir;
	const tile_x = adt.tileX;
	const tile_y = adt.tileY;
	const prefix = util.format('world/maps/%s/%s', map_dir, map_dir);
	const tile_prefix = prefix + '_' + adt.tileY + '_' + adt.tileX;

	try {
		const root_fid = listfile.getByFilename(tile_prefix + '.adt');
		if (!root_fid) {
			log.write('Cannot find fileDataID for %s.adt', tile_prefix);
			return null;
		}

		const root_file = await core.view.casc.getFile(root_fid);
		const root_adt = new ADTLoader(root_file);
		
		root_adt.loadRoot();

		if (!root_adt.chunks || root_adt.chunks.length === 0) {
			log.write('No chunks found in ADT file %s', tile_prefix);
			return null;
		}

		const heights = new Float32Array(resolution * resolution);
		const px_per_row = resolution;
		for (let py = 0; py < resolution; py++) {
			for (let px = 0; px < resolution; px++) {
				const chunk_x = Math.floor(px * 16 / resolution);
				const chunk_y = Math.floor(py * 16 / resolution);
				const chunk_index = chunk_y * 16 + chunk_x;
				
				if (chunk_index >= root_adt.chunks.length)
					continue;
				
				const chunk = root_adt.chunks[chunk_index];
				if (!chunk || !chunk.vertices)
					continue;
				
				// map pixel to position within the chunk (0-1 range)
				const local_x = (px * 16 / resolution) - chunk_x;
				const local_y = (py * 16 / resolution) - chunk_y;
				
				const height = sampleChunkHeight(chunk, local_x, local_y);
				
				const height_idx = py * px_per_row + px;
				heights[height_idx] = height;
			}
		}

		return {
			heights: heights,
			resolution: resolution,
			tileX: tile_x,
			tileY: tile_y
		};

	} catch (e) {
		log.write('Error extracting height data from tile %s: %s', tile_prefix, e.message);
		return null;
	}
};

/**
 * Parse a map entry from the listbox.
 * @param {string} entry 
 */
const parseMapEntry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('Unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3] };
};

// The first time the user opens up the map tab, initialize map names.
core.events.once('screen-tab-maps', async () => {
	core.view.isBusy++;
	core.setToast('progress', 'Checking for available maps, hold on...', null, -1, false);

	const table = new WDCReader('DBFilesClient/Map.db2');
	await table.parse();

	const maps = [];
	for (const [id, entry] of table.getAllRows()) {
		const wdtPath = util.format('world/maps/%s/%s.wdt', entry.Directory, entry.Directory);

		if (entry.WdtFileDataID != null && listfile.getByID(entry.WdtFileDataID) == null) {
			log.write('Adding files to listfile for map %s (%d)', entry.MapName_lang, entry.WdtFileDataID);
			listfile.addEntry(entry.WdtFileDataID, wdtPath);

			try {
				const data = await core.view.casc.getFileByName(wdtPath);
				const wdt = selectedWDT = new WDTLoader(data);
				wdt.load();

				for (let x = 0; x < 64; x++) {
					for (let y = 0; y < 64; y++) {
						const tile = wdt.entries[x * 64 + y];
						if (tile.rootADT != 0) {
							const tileBasePath = util.format('world/maps/%s/map%s_%s_%s', entry.Directory, entry.Directory, x, y);
							listfile.addEntry(tile.rootADT, tileBasePath + ".adt");
							listfile.addEntry(tile.obj0ADT, tileBasePath + "_obj0.adt");
							listfile.addEntry(tile.obj1ADT, tileBasePath + "_obj1.adt");
							listfile.addEntry(tile.tex0ADT, tileBasePath + "_tex0.adt");
							listfile.addEntry(tile.lodADT, tileBasePath + "_lod.adt");

							const paddedX = x.toString().padStart(2, '0');
							const paddedY = y.toString().padStart(2, '0');
							listfile.addEntry(tile.minimapTexture, util.format('world/minimaps/%s/map%s_%s.blp', entry.Directory, paddedX, paddedY));
							listfile.addEntry(tile.mapTexture, util.format('world/maptextures/%s/%s_%s_%s.blp', entry.Directory, entry.Directory, paddedX, paddedY));
							listfile.addEntry(tile.mapTextureN, util.format('world/maptextures/%s/%s_%s_%s_n.blp', entry.Directory, entry.Directory, paddedX, paddedY));
						}
					}
				}
			} catch (e) {
				log.write('Failed to add files to listfile for WDT %s', wdtPath);
			}
		}

		if (listfile.getByFilename(wdtPath))
			maps.push(util.format('%d\x19[%d]\x19%s\x19(%s)', entry.ExpansionID, id, entry.MapName_lang, entry.Directory));
	}

	core.view.mapViewerMaps = maps;
	
	core.hideToast();
	core.view.isBusy--;
});

core.registerLoadFunc(async () => {
	// Store a reference to loadMapTile for the map viewer component.
	core.view.mapViewerTileLoader = loadMapTile;

	// Track selection changes on the map listbox and select that map.
	core.view.$watch('selectionMaps', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];

		if (!core.view.isBusy && first) {
			const map = parseMapEntry(first);
			if (selectedMapID !== map.id)
				loadMap(map.id, map.dir);
		}
	});

	// Track when user clicks to export a map or world model.
	core.events.on('click-export-map', () => {
		const format = core.view.config.exportMapFormat;
		if (format === 'OBJ')
			exportSelectedMap();
		else if (format === 'PNG')
			exportSelectedMapAsPNG();
		else if (format === 'RAW')
			exportSelectedMapAsRaw();
		else if (format === 'HEIGHTMAPS')
			exportSelectedMapAsHeightmaps();
	});
	core.events.on('click-export-map-wmo', () => exportSelectedMapWMO());
});