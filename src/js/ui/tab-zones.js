/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const util = require('util');
const core = require('../core');
const log = require('../log');
const db2 = require('../casc/db2');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const path = require('path');

let selectedZoneID;

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
 * Export selected zone maps as PNG/WEBP.
 */
const exportZoneMap = async () => {
	const userSelection = core.view.selectionZones;
	if (!userSelection || userSelection.length === 0) {
		core.setToast('info', 'You didn\'t select any zones to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(userSelection.length, 'zone');
	helper.start();

	const format = core.view.config.exportTextureFormat;
	const ext = format === 'WEBP' ? '.webp' : '.png';
	const mimeType = format === 'WEBP' ? 'image/webp' : 'image/png';

	for (const zoneEntry of userSelection) {
		if (helper.isCancelled())
			return;

		try {
			const zone = parseZoneEntry(zoneEntry);
			const exportCanvas = document.createElement('canvas');

			log.write('Exporting zone map: %s (%d)', zone.zoneName, zone.id);

			const mapInfo = await renderZoneToCanvas(exportCanvas, zone.id, true);

			if (mapInfo.width === 0 || mapInfo.height === 0) {
				log.write('No map data available for zone %d, skipping', zone.id);
				helper.mark(`Zone_${zone.id}`, false, 'No map data available');
				continue;
			}

			// normalize filename by removing special characters and replacing spaces with underscores
			const normalizedZoneName = zone.zoneName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
			const normalizedAreaName = zone.areaName.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');

			const filename = `Zone_${zone.id}_${normalizedZoneName}_${normalizedAreaName}${ext}`;
			const exportPath = ExportHelper.getExportPath(path.join('zones', filename));

			log.write('Exporting zone map at full resolution (%dx%d): %s', mapInfo.width, mapInfo.height, filename);

			const buf = await BufferWrapper.fromCanvas(exportCanvas, mimeType, core.view.config.exportWebPQuality);
			await buf.writeToFile(exportPath);

			helper.mark(path.join('zones', filename), true);

			log.write('Successfully exported zone map to: %s', exportPath);
		} catch (e) {
			log.write('Failed to export zone map: %s', e.message);
			helper.mark(zoneEntry, false, e.message, e.stack);
		}
	}

	helper.finish();
};

/**
 * Render a zone map to any canvas.
 * @param {HTMLCanvasElement} canvas - Target canvas
 * @param {number} zoneID - AreaTable zone ID
 * @param {boolean} setCanvasSize - Whether to resize the canvas to map dimensions
 * @returns {Object} - Map metadata including dimensions
 */
const renderZoneToCanvas = async (canvas, zoneID, setCanvasSize = true) => {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	let uiMapID = null;

	for (const assignment of (await db2.UiMapAssignment.getAllRows()).values()) {
		if (assignment.AreaID === zoneID) {
			uiMapID = assignment.UiMapID;
			break;
		}
	}

	if (!uiMapID) {
		log.write('No UiMap found for zone ID %d', zoneID);
		throw new Error('No map data available for this zone');
	}

	const mapData = await db2.UiMap.getRow(uiMapID);
	if (!mapData) {
		log.write('UiMap entry not found for ID %d', uiMapID);
		throw new Error('UiMap entry not found');
	}

	const artStyles = [];
	
	const linkedArtIDs = [];
	for (const linkEntry of (await db2.UiMapXMapArt.getAllRows()).values()) {
		if (linkEntry.UiMapID === uiMapID)
			linkedArtIDs.push(linkEntry.UiMapArtID);
	}

	for (const artID of linkedArtIDs) {
		const artEntry = await db2.UiMapArt.getRow(artID);
		if (artEntry) {
			let styleLayer;

			for (const artStyleLayer of (await db2.UiMapArtStyleLayer.getAllRows()).values()) {
				if (artStyleLayer.UiMapArtStyleID === artEntry.UiMapArtStyleID)
					styleLayer = artStyleLayer;
			}

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
		throw new Error('No art styles found for map');
	}

	log.write('Found %d art styles for UiMap ID %d', artStyles.length, uiMapID);
	artStyles.sort((a, b) => (a.LayerIndex || 0) - (b.LayerIndex || 0));

	let mapWidth = 0, mapHeight = 0;

	for (const artStyle of artStyles) {
		const allTiles = await db2.UiMapArtTile.getRelationRows(artStyle.ID);
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
			mapWidth = artStyle.LayerWidth;
			mapHeight = artStyle.LayerHeight;
			if (setCanvasSize) {
				canvas.width = mapWidth;
				canvas.height = mapHeight;
			}
		}

		const layerIndices = Object.keys(tilesByLayer).sort((a, b) => parseInt(a) - parseInt(b));
		for (const layerIndex of layerIndices) {
			const layerTiles = tilesByLayer[layerIndex];
			const layerNum = parseInt(layerIndex);
			
			log.write('Rendering layer %d with %d tiles', layerNum, layerTiles.length);				
			await renderMapTiles(ctx, layerTiles, artStyle, layerNum, zoneID);
		}

		if (core.view.config.showZoneOverlays) {
			await renderWorldMapOverlays(ctx, artStyle, zoneID);
		}
	}

	log.write('Successfully rendered zone map for zone ID %d (UiMap ID %d)', zoneID, uiMapID);
	
	return {
		width: mapWidth,
		height: mapHeight,
		uiMapID: uiMapID
	};
};

/**
 * Load and render a zone map on the display canvas.
 * @param {number} zoneID - AreaTable zone ID
 */
const loadZoneMap = async (zoneID) => {
	const canvas = document.getElementById('zone-canvas');
	if (!canvas) {
		log.write('Zone canvas not found');
		return;
	}

	try {
		await renderZoneToCanvas(canvas, zoneID, true);
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
	const overlays = await db2.WorldMapOverlay.getRelationRows(artStyle.ID);
	if (overlays.length === 0) {
		log.write('No WorldMapOverlay entries found for UiMapArt ID %d', artStyle.ID);
		return;
	}

	for (const overlay of overlays) {
		const overlayTiles = await db2.WorldMapOverlayTile.getRelationRows(overlay.ID);
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

			// Check if zone changed or overlays disabled while loading
			if (selectedZoneID !== expectedZoneID) {
				log.write('Skipping overlay tile render - zone changed from %d to %d', expectedZoneID, selectedZoneID);
				return { success: false, tile: tile, skipped: true };
			}
			
			if (!core.view.config.showZoneOverlays) {
				log.write('Skipping overlay tile render - overlays disabled while loading');
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
	const progress = core.createProgress(3);
	core.view.setScreen('loading');
	core.view.isBusy++;

	try {
		// preload tables needed for getRelationRows
		await progress.step('Loading map tiles...');
		await db2.preload.UiMapArtTile();

		await progress.step('Loading map overlays...');
		await db2.preload.WorldMapOverlay();
		await db2.preload.WorldMapOverlayTile();

		await progress.step('Loading zone data...');

		const expansionMap = new Map();
		for (const [id, entry] of await db2.Map.getAllRows())
			expansionMap.set(id, entry.ExpansionID);
		
		log.write('Loaded %d maps for expansion mapping', expansionMap.size);

		const availableZones = new Set();		
		for (const entry of (await db2.UiMapAssignment.getAllRows()).values())
			availableZones.add(entry.AreaID);

		log.write('Loaded %d zones from UiMapAssignment', availableZones.size);

		const table = db2.AreaTable;

		const zones = [];
		for (const [id, entry] of await table.getAllRows()) {
			const expansionId = expansionMap.get(entry.ContinentID) || 0;

			if (!availableZones.has(id))
				continue;
			
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
	
	// Watch for changes to overlay setting and reload current map
	core.view.$watch('config.showZoneOverlays', async (newValue, oldValue) => {
		if (newValue !== oldValue && selectedZoneID && !core.view.isBusy) {
			log.write('Zone overlay setting changed, reloading zone %d', selectedZoneID);
			await loadZoneMap(selectedZoneID);
		}
	});
});