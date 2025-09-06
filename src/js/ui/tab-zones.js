/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const util = require('util');
const core = require('../core');
const log = require('../log');
const WDCReader = require('../db/WDCReader');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const path = require('path');

let selectedZoneID;
let uiMapAssignmentTable;
let uiMapTable;
let uiMapArtTable;
let uiMapArtTileTable;
let uiMapXMapArtTable;
let uiMapArtStyleLayerTable;
let worldMapOverlayTable;
let worldMapOverlayTileTable;

/**
 * Parse a zone entry from the listbox.
 * @param {string} entry 
 */
const parseZoneEntry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('Unexpected zone entry');

	return { id: parseInt(match[1]), zoneName: match[2], areaName: match[3] };
};

/**
 * Export the current zone map as PNG.
 */
const exportZoneMap = async () => {
	const userSelection = core.view.selectionZones;
	if (!userSelection || userSelection.length === 0) {
		core.setToast('info', 'You didn\'t select any zones to export; you should do that first.');
		return;
	}

	const canvas = document.getElementById('zone-canvas');
	if (!canvas) {
		log.write('Zone canvas not found for export');
		core.setToast('error', 'No zone map is currently displayed to export.');
		return;
	}

	if (canvas.width === 0 || canvas.height === 0) {
		core.setToast('info', 'No map data has been rendered for this zone yet.');
		return;
	}

	try {
		const zone = parseZoneEntry(userSelection[0]);
		
		// Normalize filename by removing special characters and replacing spaces with underscores
		const normalizedZoneName = zone.zoneName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
		const normalizedAreaName = zone.areaName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
		
		const filename = `Zone_${zone.id}_${normalizedZoneName}_${normalizedAreaName}.png`;
		const exportPath = ExportHelper.getExportPath(path.join('zones', filename));
		
		const helper = new ExportHelper(1, 'zone');
		helper.start();

		log.write('Exporting zone map: %s', filename);

		const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');
		await buf.writeToFile(exportPath);

		helper.mark(path.join('zones', filename), true);
		helper.finish();

		log.write('Successfully exported zone map to: %s', exportPath);
	} catch (e) {
		log.write('Failed to export zone map: %s', e.message);
		core.setToast('error', 'Failed to export zone map: ' + e.message);
	}
};

/**
 * Load and render a zone map on the canvas.
 * @param {number} zoneID - AreaTable zone ID
 */
const loadZoneMap = async (zoneID) => {
	const canvas = document.getElementById('zone-canvas');
	if (!canvas) {
		log.write('Zone canvas not found');
		return;
	}

	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	try {
		const assignmentRows = uiMapAssignmentTable.getAllRows();
		let uiMapID = null;
		
		for (const [id, assignment] of assignmentRows) {
			if (assignment.AreaID === zoneID) {
				uiMapID = assignment.UiMapID;
				break;
			}
		}

		if (!uiMapID) {
			log.write('No UiMap found for zone ID %d', zoneID);
			core.setToast('info', 'No map data available for this zone', null, 4000);
			return;
		}

		const mapData = uiMapTable.getRow(uiMapID);
		if (!mapData) {
			log.write('UiMap entry not found for ID %d', uiMapID);
			return;
		}

		const artStyles = [];
		
		const linkedArtIDs = [];
		for (const [id, linkEntry] of uiMapXMapArtTable.getAllRows()) {
			if (linkEntry.UiMapID === uiMapID)
				linkedArtIDs.push(linkEntry.UiMapArtID);
		}

		for (const artID of linkedArtIDs) {
			const artEntry = uiMapArtTable.getRow(artID);
			if (artEntry) {
				const styleLayer = uiMapArtStyleLayerTable.getRow(artEntry.UiMapArtStyleID);
				if (styleLayer) {
					const combinedStyle = {
						...artEntry,
						LayerIndex: styleLayer.LayerIndex,
						LayerWidth: styleLayer.LayerWidth,
						LayerHeight: styleLayer.LayerHeight,
						TileWidth: styleLayer.TileWidth,
						TileHeight: styleLayer.TileHeight
					};
					artStyles.push(combinedStyle);
				} else {
					log.write('No style layer found for UiMapArtStyleID %d', artEntry.UiMapArtStyleID);
				}
			}
		}

		if (artStyles.length === 0) {
			log.write('No art styles found for UiMap ID %d', uiMapID);
			return;
		}

		log.write('Found %d art styles for UiMap ID %d', artStyles.length, uiMapID);
		artStyles.sort((a, b) => (a.LayerIndex || 0) - (b.LayerIndex || 0));

		for (const artStyle of artStyles) {
			const allTiles = [];
			for (const [id, tileEntry] of uiMapArtTileTable.getAllRows()) {
				if (tileEntry.UiMapArtID === artStyle.ID)
					allTiles.push(tileEntry);
			}

			if (allTiles.length === 0) {
				log.write('No tiles found for UiMapArt ID %d', artStyle.ID);
				continue;
			}

			const tilesByLayer = allTiles.reduce((layers, tile) => {
				const layerIndex = tile.LayerIndex || 0;
				if (!layers[layerIndex])
					layers[layerIndex] = [];

				layers[layerIndex].push(tile);
				return layers;
			}, {});

			if (artStyle.LayerIndex === 0) {
				canvas.width = artStyle.LayerWidth;
				canvas.height = artStyle.LayerHeight;
			}

			const layerIndices = Object.keys(tilesByLayer).sort((a, b) => parseInt(a) - parseInt(b));
			for (const layerIndex of layerIndices) {
				const layerTiles = tilesByLayer[layerIndex];
				const layerNum = parseInt(layerIndex);
				
				log.write('Rendering layer %d with %d tiles', layerNum, layerTiles.length);				
				await renderMapTiles(ctx, layerTiles, artStyle, layerNum, zoneID);
			}

			await renderWorldMapOverlays(ctx, artStyle, zoneID);
		}

		log.write('Successfully rendered zone map for zone ID %d (UiMap ID %d)', zoneID, uiMapID);

	} catch (e) {
		log.write('Failed to render zone map: %s', e.message);
		core.setToast('error', 'Failed to load map data: ' + e.message);
	}
};

/**
 * Render map tiles to the canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} tiles
 * @param {Object} artStyle
 * @param {number} layerIndex
 * @param {number} expectedZoneID
 */
const renderMapTiles = async (ctx, tiles, artStyle, layerIndex = 0, expectedZoneID) => {
	// Sort tiles by position for proper rendering order
	tiles.sort((a, b) => {
		if (a.RowIndex !== b.RowIndex)
			return a.RowIndex - b.RowIndex;

		return a.ColIndex - b.ColIndex;
	});

	const tilePromises = tiles.map(async (tile) => {
		try {
			const pixelX = tile.ColIndex * artStyle.TileWidth;
			const pixelY = tile.RowIndex * artStyle.TileHeight;

			const finalX = pixelX + (tile.OffsetX || 0);
			const finalY = pixelY + (tile.OffsetY || 0);

			log.write('Rendering tile FileDataID %d at position (%d,%d) -> (%d,%d) [Layer %d]', 
				tile.FileDataID, tile.ColIndex, tile.RowIndex, finalX, finalY, layerIndex);

			const data = await core.view.casc.getFile(tile.FileDataID);
			const blp = new BLPFile(data);

			// Check if zone changed while loading
			if (selectedZoneID !== expectedZoneID) {
				log.write('Skipping tile render - zone changed from %d to %d', expectedZoneID, selectedZoneID);
				return { success: false, tile: tile, skipped: true };
			}

			const tileCanvas = blp.toCanvas(0b1111);
			ctx.drawImage(tileCanvas, finalX, finalY);

			return { success: true, tile: tile };
		} catch (e) {
			log.write('Failed to render tile FileDataID %d: %s', tile.FileDataID, e.message);
			return { success: false, tile: tile, error: e.message };
		}
	});

	const results = await Promise.all(tilePromises);
	const successful = results.filter(r => r.success).length;
	log.write('Rendered %d/%d tiles successfully', successful, tiles.length);
};

/**
 * Render WorldMapOverlay explored area overlays.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} artStyle
 * @param {number} expectedZoneID
 */
const renderWorldMapOverlays = async (ctx, artStyle, expectedZoneID) => {
	const overlays = [];
	for (const [id, overlay] of worldMapOverlayTable.getAllRows()) {
		if (overlay.UiMapArtID === artStyle.ID)
			overlays.push(overlay);
	}

	if (overlays.length === 0) {
		log.write('No WorldMapOverlay entries found for UiMapArt ID %d', artStyle.ID);
		return;
	}

	for (const overlay of overlays) {
		const overlayTiles = [];
		for (const [id, tile] of worldMapOverlayTileTable.getAllRows()) {
			if (tile.WorldMapOverlayID === overlay.ID)
				overlayTiles.push(tile);
		}

		if (overlayTiles.length === 0) {
			log.write('No tiles found for WorldMapOverlay ID %d', overlay.ID);
			continue;
		}

		log.write('Rendering WorldMapOverlay ID %d with %d tiles at offset (%d,%d)', 
			overlay.ID, overlayTiles.length, overlay.OffsetX, overlay.OffsetY);

		await renderOverlayTiles(ctx, overlayTiles, overlay, artStyle, expectedZoneID);
	}
};

/**
 * Render overlay tiles for a specific WorldMapOverlay.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} tiles
 * @param {Object} overlay
 * @param {Object} artStyle
 * @param {number} expectedZoneID
 */
const renderOverlayTiles = async (ctx, tiles, overlay, artStyle, expectedZoneID) => {
	tiles.sort((a, b) => {
		if (a.RowIndex !== b.RowIndex)
			return a.RowIndex - b.RowIndex;

		return a.ColIndex - b.ColIndex;
	});

	const tilePromises = tiles.map(async (tile) => {
		try {
			const baseX = overlay.OffsetX + (tile.ColIndex * artStyle.TileWidth);
			const baseY = overlay.OffsetY + (tile.RowIndex * artStyle.TileHeight);

			log.write('Rendering overlay tile FileDataID %d at position (%d,%d) -> (%d,%d)', 
				tile.FileDataID, tile.ColIndex, tile.RowIndex, baseX, baseY);

			const data = await core.view.casc.getFile(tile.FileDataID);
			const blp = new BLPFile(data);

			// Check if zone changed while loading
			if (selectedZoneID !== expectedZoneID) {
				log.write('Skipping overlay tile render - zone changed from %d to %d', expectedZoneID, selectedZoneID);
				return { success: false, tile: tile, skipped: true };
			}

			const tileCanvas = blp.toCanvas(0b1111);
			ctx.drawImage(tileCanvas, baseX, baseY);

			return { success: true, tile: tile };
		} catch (e) {
			log.write('Failed to render overlay tile FileDataID %d: %s', tile.FileDataID, e.message);
			return { success: false, tile: tile, error: e.message };
		}
	});

	const results = await Promise.all(tilePromises);
	const successful = results.filter(r => r.success).length;
	log.write('Rendered %d/%d overlay tiles successfully', successful, tiles.length);
};

core.events.once('screen-tab-zones', async () => {
	const progress = core.createProgress(10);
	core.view.setScreen('loading');
	core.view.isBusy++;

	try {
		await progress.step('Loading expansion mapping...');
		const mapTable = new WDCReader('DBFilesClient/Map.db2');
		await mapTable.parse();
		
		const expansionMap = new Map();
		for (const [id, entry] of mapTable.getAllRows())
			expansionMap.set(id, entry.ExpansionID);
		
		log.write('Loaded %d maps for expansion mapping', expansionMap.size);

		// Load required tables for map rendering
		await progress.step('Loading UI map assignments...');
		uiMapAssignmentTable = new WDCReader('DBFilesClient/UiMapAssignment.db2');
		await uiMapAssignmentTable.parse();
		log.write('Loaded UiMapAssignment.db2 with %d entries', uiMapAssignmentTable.getAllRows().size);

		await progress.step('Loading UI maps...');
		uiMapTable = new WDCReader('DBFilesClient/UiMap.db2');
		await uiMapTable.parse();
		log.write('Loaded UiMap.db2 with %d entries', uiMapTable.getAllRows().size);

		await progress.step('Loading map art data...');
		uiMapArtTable = new WDCReader('DBFilesClient/UiMapArt.db2');
		await uiMapArtTable.parse();
		log.write('Loaded UiMapArt.db2 with %d entries', uiMapArtTable.getAllRows().size);

		await progress.step('Loading map art tiles...');
		uiMapArtTileTable = new WDCReader('DBFilesClient/UiMapArtTile.db2');
		await uiMapArtTileTable.parse();
		log.write('Loaded UiMapArtTile.db2 with %d entries', uiMapArtTileTable.getAllRows().size);

		await progress.step('Loading map art mappings...');
		uiMapXMapArtTable = new WDCReader('DBFilesClient/UiMapXMapArt.db2');
		await uiMapXMapArtTable.parse();
		log.write('Loaded UiMapXMapArt.db2 with %d entries', uiMapXMapArtTable.getAllRows().size);

		await progress.step('Loading art style layers...');
		uiMapArtStyleLayerTable = new WDCReader('DBFilesClient/UiMapArtStyleLayer.db2');
		await uiMapArtStyleLayerTable.parse();
		log.write('Loaded UiMapArtStyleLayer.db2 with %d entries', uiMapArtStyleLayerTable.getAllRows().size);

		await progress.step('Loading world map overlays...');
		worldMapOverlayTable = new WDCReader('DBFilesClient/WorldMapOverlay.db2');
		await worldMapOverlayTable.parse();
		log.write('Loaded WorldMapOverlay.db2 with %d entries', worldMapOverlayTable.getAllRows().size);

		await progress.step('Loading overlay tiles...');
		worldMapOverlayTileTable = new WDCReader('DBFilesClient/WorldMapOverlayTile.db2');
		await worldMapOverlayTileTable.parse();
		log.write('Loaded WorldMapOverlayTile.db2 with %d entries', worldMapOverlayTileTable.getAllRows().size);

		await progress.step('Loading zone data...');
		const table = new WDCReader('DBFilesClient/AreaTable.db2');
		await table.parse();

		const zones = [];
		for (const [id, entry] of table.getAllRows()) {
			const expansionId = expansionMap.get(entry.ContinentID) || 0;
			
			// Format: ExpansionID\x19[ID]\x19ZoneName\x19(AreaName_lang)
			zones.push(
				util.format('%d\x19[%d]\x19%s\x19(%s)',
				expansionId, id, entry.AreaName_lang, entry.ZoneName)
			);
		}

		core.view.zoneViewerZones = zones;
		log.write('Loaded %d zones from AreaTable', zones.length);
		
		core.view.loadPct = -1;
		core.view.isBusy--;
		core.view.setScreen('tab-zones');
	} catch (e) {
		core.setToast('error', 'Failed to load zone data: ' + e.message, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load AreaTable.db2: %s', e.message);
		
		core.view.loadPct = -1;
		core.view.isBusy--;
		core.view.setScreen('tab-zones');
	}
});

core.registerLoadFunc(async () => {
	// Track selection changes on the zones listbox.
	core.view.$watch('selectionZones', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];

		if (!core.view.isBusy && first) {
			const zone = parseZoneEntry(first);
			if (selectedZoneID !== zone.id) {
				selectedZoneID = zone.id;
				log.write('Selected zone: %s (%d)', zone.zoneName, zone.id);
				await loadZoneMap(zone.id);
			}
		}
	});

	// Track when the user clicks to export the zone map.
	core.events.on('click-export-zone', async () => {
		await exportZoneMap();
	});
});