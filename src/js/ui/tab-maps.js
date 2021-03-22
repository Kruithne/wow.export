/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../core');
const log = require('../log');
const path = require('path');
const listfile = require('../casc/listfile');
const constants = require('../constants');

const WDCReader = require('../db/WDCReader');
const BLPFile = require('../casc/blp');
const WDTLoader = require('../3D/loaders/WDTLoader');
const ADTExporter = require('../3D/exporters/ADTExporter');
const ExportHelper = require('../casc/export-helper');
const WMOExporter = require('../3D/exporters/WMOExporter');
const FileWriter = require('../file-writer');

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
	selectedMapID = mapID;
	selectedMapDir = mapDir;

	selectedWDT = null;
	core.view.mapViewerHasWorldModel = false;

	// Attempt to load the WDT for this map for chunk masking.
	const wdtPath = util.format('world/maps/%s/%s.wdt', mapDir, mapDir);
	log.write('Loading map preview for %s (%d)', mapDir, mapID);

	try {
		const data = await core.view.casc.getFileByName(wdtPath);
		const wdt = selectedWDT = new WDTLoader(data);
		wdt.load();

		// Enable the 'Export Global WMO' button if available.
		if (wdt.worldModelPlacement)
			core.view.mapViewerHasWorldModel = true;

		core.view.mapViewerChunkMask = wdt.tiles;
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
		const tilePath = util.format('world/minimaps/%s/map%d_%d.blp', selectedMapDir, x, y);
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
		helper.mark('world model', false, e.message);
	}

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

	const exportPaths = new FileWriter(constants.LAST_EXPORT, 'utf8');

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
			const outputPath = await adt.export(dir, exportQuality, gameObjects, helper);
			exportPaths.writeLine('ADT_OBJ:' + outputPath);
			helper.mark(markPath, true);
		} catch (e) {
			helper.mark(markPath, false, e.message);
		}
	}

	await exportPaths.close();

	// Clear the internal ADTLoader cache.
	ADTExporter.clearCache();

	helper.finish();
};

/**
 * Parse a map entry from the listbox.
 * @param {string} entry 
 */
const parseMapEntry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('Unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3].toLowerCase() };
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
	core.events.on('click-export-map', () => exportSelectedMap());
	core.events.on('click-export-map-wmo', () => exportSelectedMapWMO());
});