const util = require('util');
const core = require('../core');

const DBHandler = require('../db/DBHandler');
const DB_Map = require('../db/schema/Map');
const BLPFile = require('../casc/blp');

let selectedMapID;
let selectedMapDir;

/**
 * Load a map into the map viewer.
 * @param {number} mapID 
 * @param {string} mapDir 
 */
const loadMap = (mapID, mapDir) => {
	selectedMapID = mapID;
	selectedMapDir = mapDir;

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

/**
 * Parse a map entry from the listbox.
 * @param {string} entry 
 */
const parseMapEntry = (entry) => {
	const parts = entry.split('\31');

	if (parts.length !== 3)
		throw new Error('Unexpected part count for map entry.');

	const mapID = parseInt(parts[0].substr(1, parts[0].length - 2));
	if (isNaN(mapID))
		throw new Error('Invalid map ID in map entry: ' + parts[0]);

	const mapDir = parts[2].substr(1, parts[2].length - 2).toLowerCase();
	return [mapID, parts[1], mapDir];
};

// The first time the user opens up the map tab, initialize map names.
core.events.once('screen-tab-maps', async () => {
	core.view.isBusy++;
	core.setToast('progress', 'Checking for available maps, hold on...', null, -1, false);

	const table = await DBHandler.openTable('dbfilesclient/map.db2', DB_Map);

	const maps = [];
	for (const [id, entry] of table.rows)
		maps.push(util.format('[%d]\31%s\31(%s)', id, entry.MapName, entry.Directory));

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
			const [mapID, mapName, mapDir] = parseMapEntry(first);
			if (selectedMapID !== mapID)
				loadMap(mapID, mapDir);
		}
	});
});