const util = require('util');
const core = require('../core');
const log = require('../log');
const path = require('path');
const listfile = require('../casc/listfile');

const DBHandler = require('../db/DBHandler');
const DB_Map = require('../db/schema/Map');
const BLPFile = require('../casc/blp');
const WDTLoader = require('../3D/loaders/WDTLoader');
const ADTExporter = require('../3D/exporters/ADTExporter');
const ExportHelper = require('../casc/export-helper');

let selectedMapID;
let selectedMapDir;

/**
 * Load a map into the map viewer.
 * @param {number} mapID 
 * @param {string} mapDir 
 */
const loadMap = async (mapID, mapDir) => {
	selectedMapID = mapID;
	selectedMapDir = mapDir;

	// Attempt to load the WDT for this map for chunk masking.
	const wdtPath = util.format('world/maps/%s/%s.wdt', mapDir, mapDir);
	log.write('Loading map preview for %s (%d)', mapDir, mapID);

	try {
		const data = await core.view.casc.getFileByName(wdtPath);
		const wdt = new WDTLoader(data);
		wdt.load();

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
		const canvas = blp.toCanvas(false);

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

const exportSelectedMap = async () => {
	const exportTiles = core.view.mapViewerSelection;
	const exportQuality = core.view.config.exportMapQuality;

	const helper = new ExportHelper(exportTiles.length, 'tile');
	helper.start();

	const dir = ExportHelper.getExportPath(path.join('maps', selectedMapDir));

	for (const index of exportTiles) {
		const adt = new ADTExporter(selectedMapID, selectedMapDir, index);

		try {
			await adt.export(dir, exportQuality);
			helper.mark(adt.tileID, true);
		} catch (e) {
			helper.mark(adt.tileID, false, e.message);
		}
	}

	// Clear the internal ADTLoader cache.
	ADTExporter.clearCache();

	helper.finish();
};

/**
 * Parse a map entry from the listbox.
 * @param {string} entry 
 */
const parseMapEntry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^\)]+)\)/);
	if (!match)
		throw new Error('Unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3].toLowerCase() };
};

// The first time the user opens up the map tab, initialize map names.
core.events.once('screen-tab-maps', async () => {
	core.view.isBusy++;
	core.setToast('progress', 'Checking for available maps, hold on...', null, -1, false);

	const table = await DBHandler.openTable('DBFilesClient/Map.db2', DB_Map);

	const maps = [];
	for (const [id, entry] of table.rows) {
		const wdtPath = util.format('world/maps/%s/%s.wdt', entry.Directory, entry.Directory);
		if (listfile.getByFilename(wdtPath))
			maps.push(util.format('[%d]\x19%s\x19(%s)', id, entry.MapName, entry.Directory));
	}

	core.view.mapViewerMaps = maps;
	
	core.hideToast();
	core.view.isBusy--;
});

core.events.once('init', () => {
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

	// Track when user clicks to export a map.
	core.events.on('click-export-map', () => exportSelectedMap());
});