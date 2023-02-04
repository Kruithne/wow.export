/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';

import Log from '../log';
import Listfile from '../casc/listfile';
import Constants from '../constants';
import State from '../state';

import WDCReader from '../db/WDCReader';
import BLPFile from '../casc/blp';
import WDTLoader from '../3D/loaders/WDTLoader';
import ADTExporter from '../3D/exporters/ADTExporter';
import ExportHelper from '../casc/export-helper';
import WMOExporter from '../3D/exporters/WMOExporter';
import FileWriter from '../file-writer';

import GameObjectDisplayInfo from '../db/types/GameObjectDisplayInfo';
import GameObjects from '../db/types/GameObjects';

let selectedMapID: number;
let selectedMapDir: string;
let selectedWDT: WDTLoader | undefined;

const TILE_SIZE = Constants.GAME.TILE_SIZE;
const MAP_OFFSET = Constants.GAME.MAP_OFFSET;

let gameObjectsDB2: Map<number, Set<GameObjects>>;

interface GameObjectEntry extends GameObjects {
	FileDataID: number;
}

/**
 * Load a map into the map viewer.
 * @param mapID
 * @param mapDir
 */
async function loadMap(mapID: number, mapDir: string): Promise<void> {
	const mapDirLower = mapDir.toLowerCase();

	selectedMapID = mapID;
	selectedMapDir = mapDirLower;

	selectedWDT = undefined;
	State.mapViewerHasWorldModel = false;

	// Attempt to load the WDT for this map for chunk masking.
	const wdtPath = util.format('world/maps/%s/%s.wdt', mapDirLower, mapDirLower);
	Log.write('Loading map preview for %s (%d)', mapDirLower, mapID);

	try {
		const data = await State.state.casc.getFileByName(wdtPath);
		const wdt = selectedWDT = new WDTLoader(data);
		wdt.load();

		// Enable the 'Export Global WMO' button if available.
		if (wdt.worldModelPlacement)
			State.mapViewerHasWorldModel = true;

		State.mapViewerChunkMask = wdt.tiles;
	} catch (e) {
		// Unable to load WDT, default to all chunks enabled.
		Log.write('Cannot load %s, defaulting to all chunks enabled', wdtPath);
		State.mapViewerChunkMask = null;
	}

	// Reset the tile selection.
	State.mapViewerSelection.splice(0);

	// While not used directly by the components, we update this reactive value
	// so that the components know a new map has been selected, and to request tiles.
	State.mapViewerSelectedMap = mapID;

	// Purposely provide the raw mapDir here as it's used by the external link module
	// and wow.tools requires a properly cased map name.
	State.mapViewerSelectedDir = mapDir;
}

/**
 * Load a map tile.
 * @param x
 * @param y
 * @param size
 */
async function loadMapTile(x: number, y: number, size: number): Promise<ImageData | false> {
	// If no map has been selected, abort.
	if (!selectedMapDir)
		return false;

	try {
		// Attempt to load the requested tile from CASC.
		const paddedX = x.toString().padStart(2, '0');
		const paddedY = y.toString().padStart(2, '0');
		const tilePath = util.format('world/minimaps/%s/map%s_%s.blp', selectedMapDir, paddedX, paddedY);
		const data = await State.state.casc.getFileByName(tilePath, false, true);
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
		if (ctx === null)
			throw new Error('Unable to get 2D context for canvas');

		ctx.scale(scale, scale);
		ctx.drawImage(canvas, 0, 0);

		return ctx.getImageData(0, 0, size, size);
	} catch (e) {
		// Map tile does not exist or cannot be read.
		return false;
	}
}

/**
 * Collect game objects from GameObjects.db2 for export.
 * @param mapID - Map ID to collect game objects for.
 * @param filter - Filter function to apply to the game objects.
 * @returns Set of game objects.
 */
async function collectGameObjects(mapID: number, filter: (row: GameObjects) => boolean): Promise<Set<GameObjects>> {
	// Load GameObjects.db2/GameObjectDisplayInfo.db2 on-demand.
	if (gameObjectsDB2 === undefined) {
		const objTable = new WDCReader('DBFilesClient/GameObjects.db2');
		await objTable.parse();

		const idTable = new WDCReader('DBFilesClient/GameObjectDisplayInfo.db2');
		await idTable.parse();

		// Index all of the rows by the map ID.
		gameObjectsDB2 = new Map<number, Set<GameObjects>>();
		for (const row of objTable.getAllRows().values() as IterableIterator<GameObjects>) {
			// Look-up the fileDataID ahead of time.
			const fidRow = idTable.getRow(row.DisplayID) as GameObjectDisplayInfo;

			if (fidRow !== null) {
				const entry = row as GameObjectEntry;
				entry.FileDataID = fidRow.FileDataID;

				let map = gameObjectsDB2.get(entry.OwnerID);
				if (map === undefined) {
					map = new Set();
					map.add(entry);
					gameObjectsDB2.set(entry.OwnerID, map);
				} else {
					map.add(entry);
				}
			}
		}
	}

	const result = new Set<GameObjects>();
	const mapObjects = gameObjectsDB2.get(mapID);

	if (mapObjects !== undefined) {
		for (const obj of mapObjects) {
			if (filter !== undefined && filter(obj))
				result.add(obj);
		}
	}

	return result;
}

async function exportSelectedMapWMO(): Promise<void> {
	const helper = new ExportHelper(1, 'WMO');
	helper.start();

	try {
		if (!selectedWDT || !selectedWDT.worldModelPlacement)
			throw new Error('Map does not contain a world model.');

		const placement = selectedWDT.worldModelPlacement;
		let fileDataID: number | undefined = 0;
		let fileName: string;

		if (selectedWDT.worldModel) {
			fileName = selectedWDT.worldModel;
			fileDataID = Listfile.getByFilename(fileName);

			if (fileDataID === undefined)
				throw new Error('Invalid world model path: ' + fileName);
		} else {
			if (placement.id === 0)
				throw new Error('Map does not define a valid world model.');

			fileDataID = placement.id;
			fileName = Listfile.getByID(fileDataID as number) || 'unknown_' + fileDataID + '.wmo';
		}

		const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), '.obj');

		const data = await State.state.casc.getFile(fileDataID);
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
}

async function exportSelectedMap(): Promise<void> {
	const exportTiles = State.mapViewerSelection;
	const exportQuality = State.state.config.exportMapQuality;

	// User has not selected any tiles.
	if (exportTiles.length === 0)
		return State.state.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

	const helper = new ExportHelper(exportTiles.length, 'tile');
	helper.start();

	const dir = ExportHelper.getExportPath(path.join('maps', selectedMapDir));

	const exportPaths = new FileWriter(State.state.lastExportPath, 'utf8');

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
		let gameObjects = new Set<GameObjects>();
		if (State.state.config.mapsIncludeGameObjects === true) {
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
			exportPaths.writeLine(out.type + ':' + out.path);
			helper.mark(markPath, true);
		} catch (e) {
			helper.mark(markPath, false, e.message);
		}
	}

	await exportPaths.close();

	// Clear the internal ADTLoader cache.
	ADTExporter.clearCache();

	helper.finish();
}

/**
 * Parse a map entry from the listbox.
 * @param {string} entry
 */
function parseMapEntry(entry: string): { id: number, name: string, dir: string } {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('Unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3] };
}

// The first time the user opens up the map tab, initialize map names.
State.events.once('screen-tab-maps', async () => {
	State.state.isBusy++;
	State.state.setToast('progress', 'Checking for available maps, hold on...', null, -1, false);

	const table = new WDCReader('DBFilesClient/Map.db2');
	await table.parse();

	const maps = Array<string>();
	for (const [id, entry] of table.getAllRows()) {
		const wdtPath = util.format('world/maps/%s/%s.wdt', entry.Directory, entry.Directory);
		if (Listfile.getByFilename(wdtPath))
			maps.push(util.format('%d\x19[%d]\x19%s\x19(%s)', entry.ExpansionID, id, entry.MapName_lang, entry.Directory));
	}

	State.mapViewerMaps = maps;

	State.state.hideToast();
	State.state.isBusy--;
});

State.state.registerLoadFunc(async () => {
	// Store a reference to loadMapTile for the map viewer component.
	State.mapViewerTileLoader = loadMapTile;

	// Track selection changes on the map listbox and select that map.
	State.state.$watch('selectionMaps', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];

		if (!State.state.isBusy && first) {
			const map = parseMapEntry(first);
			if (selectedMapID !== map.id)
				loadMap(map.id, map.dir);
		}
	});

	// Track when user clicks to export a map or world model.
	State.events.on('click-export-map', () => exportSelectedMap());
	State.events.on('click-export-map-wmo', () => exportSelectedMapWMO());
});