const fsp = require('fs').promises;
const db2 = require('./casc/db2');
const log = require('./log');
const BLPFile = require('./casc/blp');
const TiledPNGWriter = require('./tiled-png-writer');

// fixed pixel size of a wmo minimap block (blockX/blockY step; 2 px per world unit).
const MINIMAP_BLOCK_SIZE = 256;

// minimap pixels per world unit (group bboxes are scaled x2 in compute_minimap_layout).
const MINIMAP_PPU = 2;

// temporary: dump layout/composite diagnostics to log to diagnose missing chunks.
const DIAG = true;

let wmo_minimap_textures = null;

const load_minimap_textures = async () => {
	if (wmo_minimap_textures !== null)
		return;

	wmo_minimap_textures = new Map();
	for (const row of (await db2.WMOMinimapTexture.getAllRows()).values()) {
		let tiles = wmo_minimap_textures.get(row.WMOID);
		if (tiles === undefined) {
			tiles = [];
			wmo_minimap_textures.set(row.WMOID, tiles);
		}

		tiles.push({
			groupNum: row.GroupNum,
			blockX: row.BlockX,
			blockY: row.BlockY,
			fileDataID: row.FileDataID
		});
	}

	log.write('loaded %d WMO minimap entries', wmo_minimap_textures.size);
};

const has_minimap = (wmo_id) => {
	if (!wmo_minimap_textures)
		return false;

	const tiles = wmo_minimap_textures.get(wmo_id);
	return tiles !== undefined && tiles.length > 0;
};

const compute_minimap_layout = (wmo_id, group_info) => {
	const tiles = wmo_minimap_textures.get(wmo_id);
	if (!tiles || tiles.length === 0)
		return null;

	if (!group_info || group_info.length === 0)
		return null;

	const groups_tiles = new Map();
	for (const tile of tiles) {
		if (!groups_tiles.has(tile.groupNum))
			groups_tiles.set(tile.groupNum, []);

		groups_tiles.get(tile.groupNum).push(tile);
	}

	if (DIAG) {
		log.write('[wmo-minimap diag] wmo_id=%d, groups_with_tiles=%d, group_info.length=%d', wmo_id, groups_tiles.size, group_info.length);
		const dropped = [...groups_tiles.keys()].filter(g => g >= group_info.length);
		if (dropped.length > 0)
			log.write('[wmo-minimap diag] DROPPED groups (group_num >= group_info.length): %s', dropped.join(','));
	}

	const tile_positions = [];
	let model_z_min = Infinity, model_z_max = -Infinity;
	for (const [group_num, group_tiles] of groups_tiles) {
		if (group_num >= group_info.length)
			continue;

		const group = group_info[group_num];
		const g_min_x = Math.min(group.boundingBox1[0], group.boundingBox2[0]) * 2;
		const g_min_y = Math.min(group.boundingBox1[1], group.boundingBox2[1]) * 2;
		const g_min_z = Math.min(group.boundingBox1[2], group.boundingBox2[2]);

		if (DIAG) {
			log.write('[wmo-minimap diag] g%d: bbox x[%s..%s] y[%s..%s] z[%s..%s] -> g_min_x=%s g_min_y=%s, %d blocks [%s]',
				group_num,
				group.boundingBox1[0].toFixed(1), group.boundingBox2[0].toFixed(1),
				group.boundingBox1[1].toFixed(1), group.boundingBox2[1].toFixed(1),
				group.boundingBox1[2].toFixed(1), group.boundingBox2[2].toFixed(1),
				g_min_x.toFixed(1), g_min_y.toFixed(1),
				group_tiles.length,
				group_tiles.map(t => `(${t.blockX},${t.blockY})`).join(' '));
		}

		// model-space vertical extent (unscaled) — used to derive a placed city's
		// altitude band.
		model_z_min = Math.min(model_z_min, group.boundingBox1[2], group.boundingBox2[2]);
		model_z_max = Math.max(model_z_max, group.boundingBox1[2], group.boundingBox2[2]);

		for (const tile of group_tiles) {
			tile_positions.push({
				...tile,
				absX: g_min_x + (tile.blockX * 256),
				absY: g_min_y + (tile.blockY * 256),
				zOrder: g_min_z
			});
		}
	}

	let min_x = Infinity, max_x = -Infinity;
	let min_y = Infinity, max_y = -Infinity;

	for (const tile of tile_positions) {
		min_x = Math.min(min_x, tile.absX);
		max_x = Math.max(max_x, tile.absX + 256);
		min_y = Math.min(min_y, tile.absY);
		max_y = Math.max(max_y, tile.absY + 256);
	}

	const canvas_width = Math.ceil(max_x - min_x);
	const canvas_height = Math.ceil(max_y - min_y);

	const positioned_tiles = [];
	for (const tile of tile_positions) {
		const canvas_x = tile.absX - min_x;
		const canvas_y = (max_y - 256) - tile.absY;

		positioned_tiles.push({
			...tile,
			pixelX: canvas_x,
			pixelY: canvas_y,
			scaleX: 1,
			scaleY: 1,
			srcWidth: 256,
			srcHeight: 256
		});
	}

	if (positioned_tiles.length === 0)
		return null;

	const OUTPUT_TILE_SIZE = 256;
	const grid_width = Math.ceil(canvas_width / OUTPUT_TILE_SIZE);
	const grid_height = Math.ceil(canvas_height / OUTPUT_TILE_SIZE);
	const grid_size = Math.max(grid_width, grid_height);
	const mask = new Array(grid_size * grid_size).fill(0);
	const tiles_by_coord = new Map();

	for (const tile of positioned_tiles) {
		const grid_x = Math.floor(tile.pixelX / OUTPUT_TILE_SIZE);
		const grid_y = Math.floor(tile.pixelY / OUTPUT_TILE_SIZE);

		const tile_width = tile.srcWidth * tile.scaleX;
		const tile_height = tile.srcHeight * tile.scaleY;
		const end_grid_x = Math.floor((tile.pixelX + tile_width - 1) / OUTPUT_TILE_SIZE);
		const end_grid_y = Math.floor((tile.pixelY + tile_height - 1) / OUTPUT_TILE_SIZE);

		for (let gx = grid_x; gx <= end_grid_x; gx++) {
			for (let gy = grid_y; gy <= end_grid_y; gy++) {
				if (gx < 0 || gx >= grid_size || gy < 0 || gy >= grid_size)
					continue;

				const index = (gx * grid_size) + gy;
				mask[index] = 1;

				const key = `${gx},${gy}`;
				if (!tiles_by_coord.has(key))
					tiles_by_coord.set(key, []);

				tiles_by_coord.get(key).push({
					...tile,
					drawX: tile.pixelX - (gx * OUTPUT_TILE_SIZE),
					drawY: tile.pixelY - (gy * OUTPUT_TILE_SIZE)
				});
			}
		}
	}

	for (const tile_list of tiles_by_coord.values())
		tile_list.sort((a, b) => a.zOrder - b.zOrder);

	if (DIAG) {
		log.write('[wmo-minimap diag] canvas=%dx%d, grid=%dx%d (square %d), positioned_tiles=%d, occupied_cells=%d',
			canvas_width, canvas_height, grid_width, grid_height, grid_size, positioned_tiles.length, tiles_by_coord.size);

		// cells where blocks from >1 group land together (world-space overlap = expected
		// multi-floor compositing; useful to correlate with blank-tile gaps).
		let multi_group_cells = 0;
		for (const [key, tile_list] of tiles_by_coord) {
			const groups = new Set(tile_list.map(t => t.groupNum));
			if (groups.size > 1) {
				multi_group_cells++;
				log.write('[wmo-minimap diag] cell %s: %d blocks, groups [%s]', key, tile_list.length, [...groups].join(','));
			}
		}
		log.write('[wmo-minimap diag] cells with multi-group overlap: %d', multi_group_cells);
	}

	return {
		wmo_id,
		tiles: positioned_tiles,
		canvas_width,
		canvas_height,
		grid_width,
		grid_height,
		grid_size,
		mask,
		tiles_by_coord,
		output_tile_size: OUTPUT_TILE_SIZE,
		min_x,
		max_x,
		min_y,
		max_y,
		model_z_min: isFinite(model_z_min) ? model_z_min : null,
		model_z_max: isFinite(model_z_max) ? model_z_max : null
	};
};

// ppu (2 px per world unit) converts the pixel-space bbox to model units. for a
// global wmo placed at the wdt origin (pos 0, rot 0) model->world is a straight
// negate (world = -model). yields the world (x, y) at the exported image's top-left
// and bottom-right pixels.
const build_world_meta = (minimap_data, placement, map_id = null, map_name = null) => {
	const top_left = { world_x: -minimap_data.min_x / MINIMAP_PPU, world_y: -minimap_data.max_y / MINIMAP_PPU };
	const bottom_right = { world_x: -minimap_data.max_x / MINIMAP_PPU, world_y: -minimap_data.min_y / MINIMAP_PPU };

	const meta = {
		// engine Map.db2 id of the wmo-backed map (when exported via the maps tab),
		// distinct from wmo_id (the WMO model id), which is informational.
		map_id: map_id,
		map_name: map_name,
		wmo_id: minimap_data.wmo_id,
		ppu: MINIMAP_PPU,
		image: { width: minimap_data.canvas_width, height: minimap_data.canvas_height },
		corners: { top_left, bottom_right },
		// model-space vertical extent (z, unscaled); scale + offset by the MODF to get
		// a placed city's altitude band.
		model_z: { min: minimap_data.model_z_min, max: minimap_data.model_z_max },
		modf: null
	};

	// raw MODF (position, rotation[deg], scale uint16 where 1024=1.0) for a placed wmo.
	// global wmos pass the WDT placement here; under-terrain cities (ironforge/exodar/
	// undercity) are placed via an adt MODF, which the model export does not carry.
	if (placement) {
		meta.modf = {
			position: placement.position,
			rotation: placement.rotation,
			scale: placement.scale
		};
	}

	return meta;
};

const composite_tile = async (tile_list, size, casc, scale = 1, diag_key = null) => {
	const composite = document.createElement('canvas');
	composite.width = size;
	composite.height = size;

	const ctx = composite.getContext('2d');

	for (const tile of tile_list) {
		// tolerate per-block failures (e.g. fileDataID absent from root in this build);
		// a missing block must not discard the other valid blocks sharing this cell.
		let canvas;
		try {
			const blp_data = await casc.getFile(tile.fileDataID);
			const blp = new BLPFile(blp_data);
			canvas = blp.toCanvas(0b1111);
		} catch (e) {
			log.write('skipped WMO minimap block (cell %s, g%d, fid %d): %s', diag_key, tile.groupNum, tile.fileDataID, e.message);
			continue;
		}

		// each minimap blp renders its group footprint at true scale into a fixed
		// MINIMAP_BLOCK_SIZE cell with content anchored bottom-LEFT; cropped tiles are
		// smaller than the block, so bottom-anchor them (left stays at the cell edge).
		// otherwise thin groups (tunnels, connectors) float at the cell top and misalign.
		const draw_x = tile.drawX * scale;
		const draw_y = (tile.drawY + (MINIMAP_BLOCK_SIZE - canvas.height)) * scale;
		const draw_width = canvas.width * tile.scaleX * scale;
		const draw_height = canvas.height * tile.scaleY * scale;

		if (DIAG && (canvas.width !== MINIMAP_BLOCK_SIZE || canvas.height !== MINIMAP_BLOCK_SIZE)) {
			log.write('[wmo-minimap diag] cell %s g%d block(%d,%d) fid=%d CROPPED src=%dx%d anchor_dy=%d',
				diag_key, tile.groupNum, tile.blockX, tile.blockY, tile.fileDataID,
				canvas.width, canvas.height, MINIMAP_BLOCK_SIZE - canvas.height);
		}

		ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, draw_x, draw_y, draw_width, draw_height);
	}

	return ctx.getImageData(0, 0, size, size);
};

const export_minimap = async (minimap_data, casc, out_path, helper, placement, map_id = null, map_name = null) => {
	const { tiles_by_coord, canvas_width, canvas_height, output_tile_size } = minimap_data;

	log.write('WMO minimap export: %d tile positions, %dx%d pixels', tiles_by_coord.size, canvas_width, canvas_height);

	const writer = new TiledPNGWriter(canvas_width, canvas_height, output_tile_size);

	for (const [key, tile_list] of tiles_by_coord) {
		if (helper?.isCancelled())
			break;

		try {
			const image_data = await composite_tile(tile_list, output_tile_size, casc, 1, key);
			const [rel_x, rel_y] = key.split(',').map(Number);
			writer.addTile(rel_x, rel_y, image_data);
		} catch (e) {
			if (DIAG)
				log.write('[wmo-minimap diag] CELL DROPPED %s (%d blocks, fids [%s]): %s', key, tile_list.length, tile_list.map(t => t.fileDataID).join(','), e.message);

			log.write('failed to load WMO minimap tile at %s: %s', key, e.message);
		}
	}

	await writer.write(out_path);
	log.write('WMO minimap exported: %s', out_path);

	// sidecar describing the image's world-space placement.
	const meta = build_world_meta(minimap_data, placement, map_id, map_name);
	const meta_path = out_path.replace(/\.[^.\\/]+$/, '.json');
	await fsp.writeFile(meta_path, JSON.stringify(meta, null, '\t'));
	log.write('WMO minimap meta exported: %s', meta_path);
};

module.exports = { load_minimap_textures, has_minimap, compute_minimap_layout, composite_tile, export_minimap, build_world_meta };
