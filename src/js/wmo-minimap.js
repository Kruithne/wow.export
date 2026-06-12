const db2 = require('./casc/db2');
const log = require('./log');
const BLPFile = require('./casc/blp');
const TiledPNGWriter = require('./tiled-png-writer');

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

	const tile_positions = [];
	for (const [group_num, group_tiles] of groups_tiles) {
		if (group_num >= group_info.length)
			continue;

		const group = group_info[group_num];
		const g_min_x = Math.min(group.boundingBox1[0], group.boundingBox2[0]) * 2;
		const g_min_y = Math.min(group.boundingBox1[1], group.boundingBox2[1]) * 2;
		const g_min_z = Math.min(group.boundingBox1[2], group.boundingBox2[2]);

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
		output_tile_size: OUTPUT_TILE_SIZE
	};
};

const composite_tile = async (tile_list, size, casc, scale = 1) => {
	const composite = document.createElement('canvas');
	composite.width = size;
	composite.height = size;

	const ctx = composite.getContext('2d');

	for (const tile of tile_list) {
		const blp_data = await casc.getFile(tile.fileDataID);
		const blp = new BLPFile(blp_data);
		const canvas = blp.toCanvas(0b1111);

		const draw_x = tile.drawX * scale;
		const draw_y = tile.drawY * scale;
		const draw_width = canvas.width * tile.scaleX * scale;
		const draw_height = canvas.height * tile.scaleY * scale;

		ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, draw_x, draw_y, draw_width, draw_height);
	}

	return ctx.getImageData(0, 0, size, size);
};

const export_minimap = async (minimap_data, casc, out_path, helper) => {
	const { tiles_by_coord, canvas_width, canvas_height, output_tile_size } = minimap_data;

	log.write('WMO minimap export: %d tile positions, %dx%d pixels', tiles_by_coord.size, canvas_width, canvas_height);

	const writer = new TiledPNGWriter(canvas_width, canvas_height, output_tile_size);

	for (const [key, tile_list] of tiles_by_coord) {
		if (helper?.isCancelled())
			break;

		try {
			const image_data = await composite_tile(tile_list, output_tile_size, casc);
			const [rel_x, rel_y] = key.split(',').map(Number);
			writer.addTile(rel_x, rel_y, image_data);
		} catch (e) {
			log.write('failed to load WMO minimap tile at %s: %s', key, e.message);
		}
	}

	await writer.write(out_path);
	log.write('WMO minimap exported: %s', out_path);
};

module.exports = { load_minimap_textures, has_minimap, compute_minimap_layout, composite_tile, export_minimap };
