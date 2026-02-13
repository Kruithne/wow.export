const util = require('util');
const crypto = require('crypto');
const core = require('../core');
const log = require('../log');
const path = require('path');
const listfile = require('../casc/listfile');
const constants = require('../constants');
const InstallType = require('../install-type');

const db2 = require('../casc/db2');
const BLPFile = require('../casc/blp');
const WDTLoader = require('../3D/loaders/WDTLoader');
const ADTExporter = require('../3D/exporters/ADTExporter');
const ADTLoader = require('../3D/loaders/ADTLoader');
const ExportHelper = require('../casc/export-helper');
const WMOExporter = require('../3D/exporters/WMOExporter');
const WMOLoader = require('../3D/loaders/WMOLoader');
const TiledPNGWriter = require('../tiled-png-writer');
const PNGWriter = require('../png-writer');

const TILE_SIZE = constants.GAME.TILE_SIZE;
const MAP_OFFSET = constants.GAME.MAP_OFFSET;

let selected_map_id = null;
let selected_map_dir = null;
let selected_wdt = null;
let game_objects_db2 = null;
let wmo_minimap_textures = null;
let current_wmo_minimap = null;

/**
 * Parse a map entry from the listbox.
 * @param {string} entry
 */
const parse_map_entry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3] };
};

/**
 * Load a map tile.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 */
const load_map_tile = async (x, y, size) => {
	if (!selected_map_dir)
		return false;

	try {
		const padded_x = x.toString().padStart(2, '0');
		const padded_y = y.toString().padStart(2, '0');
		const tile_path = util.format('world/minimaps/%s/map%s_%s.blp', selected_map_dir, padded_x, padded_y);
		const data = await core.view.casc.getFileByName(tile_path, false, true);
		const blp = new BLPFile(data);

		const canvas = blp.toCanvas(0b0111);

		const scale = size / blp.scaledWidth;
		const scaled = document.createElement('canvas');
		scaled.width = size;
		scaled.height = size;

		const ctx = scaled.getContext('2d');
		ctx.scale(scale, scale);
		ctx.drawImage(canvas, 0, 0);

		return ctx.getImageData(0, 0, size, size);
	} catch (e) {
		return false;
	}
};

/**
 * Load a WMO minimap tile.
 * Composites multiple tiles at the same position using alpha blending.
 * @param {number} x
 * @param {number} y
 * @param {number} size
 */
const load_wmo_minimap_tile = async (x, y, size) => {
	if (!current_wmo_minimap)
		return false;

	const key = `${x},${y}`;
	const tile_list = current_wmo_minimap.tiles_by_coord.get(key);

	if (!tile_list || tile_list.length === 0)
		return false;

	try {
		const composite = document.createElement('canvas');
		composite.width = size;
		composite.height = size;

		const ctx = composite.getContext('2d');
		const output_scale = size / current_wmo_minimap.output_tile_size;

		for (const tile of tile_list) {
			const data = await core.view.casc.getFile(tile.fileDataID);
			const blp = new BLPFile(data);
			const canvas = blp.toCanvas(0b1111);

			const draw_x = tile.drawX * output_scale;
			const draw_y = tile.drawY * output_scale;
			const draw_width = canvas.width * tile.scaleX * output_scale;
			const draw_height = canvas.height * tile.scaleY * output_scale;

			ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, draw_x, draw_y, draw_width, draw_height);
		}

		return ctx.getImageData(0, 0, size, size);
	} catch (e) {
		return false;
	}
};

/**
 * Collect game objects from GameObjects.db2 for export.
 * @param {number} mapID
 * @param {function} filter
 */
const collect_game_objects = async (mapID, filter) => {
	if (game_objects_db2 === null) {
		game_objects_db2 = new Map();
		for (const row of (await db2.GameObjects.getAllRows()).values()) {
			const fid_row = await db2.GameObjectDisplayInfo.getRow(row.DisplayID);
			if (fid_row !== null) {
				row.FileDataID = fid_row.FileDataID;

				let map = game_objects_db2.get(row.OwnerID);
				if (map === undefined) {
					map = new Set();
					map.add(row);
					game_objects_db2.set(row.OwnerID, map);
				} else {
					map.add(row);
				}
			}
		}
	}

	const result = new Set();
	const map_objects = game_objects_db2.get(mapID);

	if (map_objects !== undefined) {
		for (const obj of map_objects) {
			if (filter !== undefined && filter(obj))
				result.add(obj);
		}
	}

	return result;
};

/**
 * Sample height at a specific position within a chunk using bilinear interpolation.
 * @param {Object} chunk
 * @param {number} localX
 * @param {number} localY
 * @returns {number}
 */
const sample_chunk_height = (chunk, localX, localY) => {
	const vx = localX * 8;
	const vy = localY * 8;

	const x0 = Math.floor(vx);
	const y0 = Math.floor(vy);
	const x1 = Math.min(8, x0 + 1);
	const y1 = Math.min(8, y0 + 1);

	const get_vert_idx = (x, y) => {
		let index = 0;
		for (let row = 0; row < y * 2; row++)
			index += (row % 2) ? 8 : 9;

		const is_short = !!(y * 2 % 2);
		index += is_short ? Math.min(x, 7) : Math.min(x, 8);
		return index;
	};

	const h00 = chunk.vertices[get_vert_idx(x0, y0)] + chunk.position[2];
	const h10 = chunk.vertices[get_vert_idx(x1, y0)] + chunk.position[2];
	const h01 = chunk.vertices[get_vert_idx(x0, y1)] + chunk.position[2];
	const h11 = chunk.vertices[get_vert_idx(x1, y1)] + chunk.position[2];

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
const extract_height_data_from_tile = async (adt, resolution) => {
	const map_dir = adt.mapDir;
	const tile_x = adt.tileX;
	const tile_y = adt.tileY;
	const prefix = util.format('world/maps/%s/%s', map_dir, map_dir);
	const tile_prefix = prefix + '_' + adt.tileY + '_' + adt.tileX;

	try {
		const root_fid = listfile.getByFilename(tile_prefix + '.adt');
		if (!root_fid) {
			log.write('cannot find fileDataID for %s.adt', tile_prefix);
			return null;
		}

		const root_file = await core.view.casc.getFile(root_fid);
		const root_adt = new ADTLoader(root_file);

		root_adt.loadRoot();

		if (!root_adt.chunks || root_adt.chunks.length === 0) {
			log.write('no chunks found in ADT file %s', tile_prefix);
			return null;
		}

		const heights = new Float32Array(resolution * resolution);
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

				const local_x = (px * 16 / resolution) - chunk_x;
				const local_y = (py * 16 / resolution) - chunk_y;

				const height = sample_chunk_height(chunk, local_x, local_y);

				// rotate 90° CW to align with terrain mesh coordinate system
				const height_idx = (resolution - 1 - px) * resolution + py;
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
		log.write('error extracting height data from tile %s: %s', tile_prefix, e.message);
		return null;
	}
};

module.exports = {
	register() {
		this.registerNavButton('Maps', 'map.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-maps">
			<div class="map-placeholder">
				<div class="expansion-buttons">
					<button class="expansion-button show-all"
							title="Show All"
							:class="{ active: $core.view.selectedExpansionFilter === -1 }"
							@click="$core.view.selectedExpansionFilter = -1">
					</button>
					<button v-for="expansion in $core.view.constants.EXPANSIONS"
							:key="expansion.id"
							class="expansion-button"
							:title="expansion.name"
							:class="{ active: $core.view.selectedExpansionFilter === expansion.id }"
							@click="$core.view.selectedExpansionFilter = expansion.id"
							:style="'background-image: var(--expansion-icon-' + expansion.id + ')'">
					</button>
				</div>
			</div>
			<div class="list-container" id="maps-list-container">
				<component :is="$components.ListboxMaps" id="listbox-maps" class="listbox-icons" v-model:selection="$core.view.selectionMaps" :items="$core.view.mapViewerMaps" :filter="$core.view.userInputFilterMaps" :expansion-filter="$core.view.selectedExpansionFilter" :keyinput="true" :single="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="map" persistscrollkey="maps" @contextmenu="handle_map_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeMap" v-slot:default="context" @close="$core.view.contextMenus.nodeMap = null">
					<span @click.self="copy_map_names(context.node.selection)">Copy map name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_internal_names(context.node.selection)">Copy internal name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_ids(context.node.selection)">Copy map ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_map_export_directory(context.node.selection)">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterMaps" placeholder="Filter maps..."/>
			</div>
			<component :is="$components.MapViewer" :map="$core.view.mapViewerSelectedMap" :loader="$core.view.mapViewerTileLoader" :tile-size="512" :zoom="12" :mask="$core.view.mapViewerChunkMask" :grid-size="$core.view.mapViewerGridSize" v-model:selection="$core.view.mapViewerSelection" :selectable="!$core.view.mapViewerIsWMOMinimap"></component>
			<div class="spaced-preview-controls">
				<input v-if="$core.view.mapViewerHasWorldModel" type="button" value="Export Global WMO" @click="export_map_wmo" :class="{ disabled: $core.view.isBusy }"/>
				<input v-if="$core.view.mapViewerHasWorldModel" type="button" value="Export WMO Minimap" @click="export_map_wmo_minimap" :class="{ disabled: $core.view.isBusy }"/>
				<component v-if="!$core.view.mapViewerIsWMOMinimap" :is="$components.MenuButton" :options="$core.view.menuButtonMapExport" :default="$core.view.config.exportMapFormat" @change="$core.view.config.exportMapFormat = $event" :disabled="$core.view.isBusy || $core.view.mapViewerSelection.length === 0" @click="export_map"></component>
			</div>

			<div id="maps-sidebar" class="sidebar">
				<span class="header">Export Options</span>
				<label class="ui-checkbox" title="Include WMO objects (large objects such as buildings)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeWMO"/>
					<span>Export WMO</span>
				</label>
				<label class="ui-checkbox" v-if="$core.view.config.mapsIncludeWMO" title="Include objects inside WMOs (interior decorations)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeWMOSets"/>
					<span>Export WMO Sets</span>
				</label>
				<label class="ui-checkbox" title="Export M2 objects on this tile (smaller objects such as trees)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeM2"/>
					<span>Export M2</span>
				</label>
				<label class="ui-checkbox" title="Export foliage used on this tile (grass, etc)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeFoliage"/>
					<span>Export Foliage</span>
				</label>
				<label v-if="!$core.view.config.mapsExportRaw" class="ui-checkbox" title="Export raw liquid data (water, lava, etc)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeLiquid"/>
					<span>Export Liquids</span>
				</label>
				<label class="ui-checkbox" title="Export client-side interactable objects (signs, banners, etc)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeGameObjects"/>
					<span>Export G-Objects</span>
				</label>
				<label v-if="!$core.view.config.mapsExportRaw" class="ui-checkbox" title="Include terrain holes for WMOs">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeHoles"/>
					<span>Include Holes</span>
				</label>
				<span class="header">Model Textures</span>
				<label class="ui-checkbox" title="Include textures when exporting models">
					<input type="checkbox" v-model="$core.view.config.modelsExportTextures"/>
					<span>Textures</span>
				</label>
				<label v-if="$core.view.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
					<input type="checkbox" v-model="$core.view.config.modelsExportAlpha"/>
					<span>Texture Alpha</span>
				</label>
				<template v-if="!$core.view.config.mapsExportRaw">
					<span class="header">Terrain Texture Quality</span>
					<component :is="$components.MenuButton" :options="$core.view.menuButtonTextureQuality" :default="$core.view.config.exportMapQuality" @change="$core.view.config.exportMapQuality = $event" :disabled="$core.view.isBusy" :dropdown="true"></component>
					<span class="header">Heightmaps</span>
					<component :is="$components.MenuButton" :options="$core.view.menuButtonHeightmapResolution" :default="$core.view.config.heightmapResolution" @change="$core.view.config.heightmapResolution = $event" :disabled="$core.view.isBusy" :dropdown="true"></component>
					<component :is="$components.MenuButton" :options="$core.view.menuButtonHeightmapBitDepth" :default="$core.view.config.heightmapBitDepth" @change="$core.view.config.heightmapBitDepth = $event" :disabled="$core.view.isBusy" :dropdown="true" style="margin-top: 5px"></component>
					<template v-if="$core.view.config.heightmapResolution === -1">
						<span class="header" style="margin-top: 10px">Heightmap Resolution</span>
						<input type="number" v-model.number="$core.view.config.heightmapCustomResolution" :disabled="$core.view.isBusy" min="1" step="1" style="width: 100%; margin: unset; margin-top: 5px; padding: 10px; box-sizing: border-box;">
					</template>
				</template>
			</div>
		</div>
	`,

	methods: {
		handle_map_context(data) {
			this.$core.view.contextMenus.nodeMap = {
				selection: data.selection,
				count: data.selection.length
			};
		},

		copy_map_names(selection) {
			const names = selection.map(entry => {
				const map = parse_map_entry(entry);
				return map.name;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_map_internal_names(selection) {
			const names = selection.map(entry => {
				const map = parse_map_entry(entry);
				return map.dir;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_map_ids(selection) {
			const ids = selection.map(entry => {
				const map = parse_map_entry(entry);
				return map.id;
			});
			nw.Clipboard.get().set(ids.join('\n'), 'text');
		},

		copy_map_export_paths(selection) {
			const paths = selection.map(entry => {
				const map = parse_map_entry(entry);
				return ExportHelper.getExportPath(path.join('maps', map.dir));
			});
			nw.Clipboard.get().set(paths.join('\n'), 'text');
		},

		open_map_export_directory(selection) {
			if (selection.length === 0)
				return;

			const map = parse_map_entry(selection[0]);
			const dir = ExportHelper.getExportPath(path.join('maps', map.dir));
			nw.Shell.openItem(dir);
		},

		async load_map(mapID, mapDir) {
			const map_dir_lower = mapDir.toLowerCase();

			this.$core.hideToast();

			selected_map_id = mapID;
			selected_map_dir = map_dir_lower;

			selected_wdt = null;
			current_wmo_minimap = null;
			this.$core.view.mapViewerHasWorldModel = false;
			this.$core.view.mapViewerIsWMOMinimap = false;
			this.$core.view.mapViewerGridSize = null;
			this.$core.view.mapViewerSelection.splice(0);

			const wdt_path = util.format('world/maps/%s/%s.wdt', map_dir_lower, map_dir_lower);
			log.write('loading map preview for %s (%d)', map_dir_lower, mapID);

			try {
				const data = await this.$core.view.casc.getFileByName(wdt_path);
				const wdt = selected_wdt = new WDTLoader(data);
				wdt.load();

				if (wdt.worldModelPlacement)
					this.$core.view.mapViewerHasWorldModel = true;

				const has_terrain = wdt.tiles && wdt.tiles.some(tile => tile === 1);
				const has_global_wmo = wdt.worldModelPlacement !== undefined;

				if (!has_terrain && has_global_wmo) {
					// try to load WMO minimap
					await this.setup_wmo_minimap(wdt);

					if (current_wmo_minimap) {
						this.$core.view.mapViewerTileLoader = load_wmo_minimap_tile;
						this.$core.view.mapViewerChunkMask = current_wmo_minimap.mask;
						this.$core.view.mapViewerGridSize = current_wmo_minimap.grid_size;
						this.$core.view.mapViewerIsWMOMinimap = true;
						this.$core.view.mapViewerSelectedMap = mapID;
						this.$core.view.mapViewerSelectedDir = mapDir;
						this.$core.setToast('info', 'Showing WMO minimap. Use "Export Global WMO" to export the world model.', null, 6000);
						return;
					}

					this.$core.setToast('info', 'This map has no terrain tiles. Use "Export Global WMO" to export the world model.', null, 6000);
				}

				// use terrain minimap loader
				this.$core.view.mapViewerTileLoader = load_map_tile;
				this.$core.view.mapViewerChunkMask = wdt.tiles;
				this.$core.view.mapViewerSelectedMap = mapID;
				this.$core.view.mapViewerSelectedDir = mapDir;
			} catch (e) {
				log.write('cannot load %s, defaulting to all chunks enabled', wdt_path);
				this.$core.view.mapViewerTileLoader = load_map_tile;
				this.$core.view.mapViewerChunkMask = null;
				this.$core.view.mapViewerSelectedMap = mapID;
				this.$core.view.mapViewerSelectedDir = mapDir;
			}
		},

		async setup_wmo_minimap(wdt) {
			try {
				const placement = wdt.worldModelPlacement;
				let file_data_id = 0;

				if (wdt.worldModel) {
					file_data_id = listfile.getByFilename(wdt.worldModel);
					if (!file_data_id)
						return;
				} else {
					if (!placement.id)
						return;

					file_data_id = placement.id;
				}

				const wmo_data = await this.$core.view.casc.getFile(file_data_id);
				const wmo = new WMOLoader(wmo_data, file_data_id);
				await wmo.load();

				const wmo_id = wmo.wmoID;
				if (!wmo_id)
					return;

				const tiles = wmo_minimap_textures.get(wmo_id);
				if (!tiles || tiles.length === 0)
					return;

				const group_info = wmo.groupInfo;
				if (!group_info || group_info.length === 0)
					return;

				// group tiles by groupNum
				const groups_tiles = new Map();
				for (const tile of tiles) {
					if (!groups_tiles.has(tile.groupNum))
						groups_tiles.set(tile.groupNum, []);

					groups_tiles.get(tile.groupNum).push(tile);
				}

				// calculate absolute pixel position for each tile
				// tile position = (bbox_min * 2) + (block * 256)
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

				// find bounds of all tiles
				let min_x = Infinity, max_x = -Infinity;
				let min_y = Infinity, max_y = -Infinity;

				for (const tile of tile_positions) {
					min_x = Math.min(min_x, tile.absX);
					max_x = Math.max(max_x, tile.absX + 256);
					min_y = Math.min(min_y, tile.absY);
					max_y = Math.max(max_y, tile.absY + 256);
				}

				// calculate canvas size and convert to canvas coords
				const canvas_width = Math.ceil(max_x - min_x);
				const canvas_height = Math.ceil(max_y - min_y);

				const positioned_tiles = [];
				for (const tile of tile_positions) {
					// convert to canvas coords (0,0 at top-left, Y flipped)
					const canvas_x = tile.absX - min_x;
					const canvas_y = (max_y - 256) - tile.absY; // flip Y for canvas

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
					return;

				// use 256px output tile size, calculate grid
				const OUTPUT_TILE_SIZE = 256;
				const grid_width = Math.ceil(canvas_width / OUTPUT_TILE_SIZE);
				const grid_height = Math.ceil(canvas_height / OUTPUT_TILE_SIZE);
				const grid_size = Math.max(grid_width, grid_height);
				const mask = new Array(grid_size * grid_size).fill(0);
				const tiles_by_coord = new Map();

				// assign tiles to grid cells based on their pixel position
				for (const tile of positioned_tiles) {
					const grid_x = Math.floor(tile.pixelX / OUTPUT_TILE_SIZE);
					const grid_y = Math.floor(tile.pixelY / OUTPUT_TILE_SIZE);

					// tile might span multiple grid cells due to scaling
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
								// offset within this grid cell
								drawX: tile.pixelX - (gx * OUTPUT_TILE_SIZE),
								drawY: tile.pixelY - (gy * OUTPUT_TILE_SIZE)
							});
						}
					}
				}

				// sort tiles in each grid cell by Z order (lower Z drawn first, higher Z on top)
				for (const tile_list of tiles_by_coord.values())
					tile_list.sort((a, b) => a.zOrder - b.zOrder);

				current_wmo_minimap = {
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

				log.write('loaded WMO minimap: %d tiles, %dx%d canvas, %dx%d grid', positioned_tiles.length, canvas_width, canvas_height, grid_width, grid_height);
				log.write('WMO minimap unique grid cells: %d', tiles_by_coord.size);
			} catch (e) {
				log.write('failed to setup WMO minimap: %s', e.message);
				current_wmo_minimap = null;
			}
		},

		async export_map_wmo() {
			const helper = new ExportHelper(1, 'WMO');
			helper.start();

			try {
				if (!selected_wdt || !selected_wdt.worldModelPlacement)
					throw new Error('map does not contain a world model.');

				const placement = selected_wdt.worldModelPlacement;
				let file_data_id = 0;
				let file_name;

				if (selected_wdt.worldModel) {
					file_name = selected_wdt.worldModel;
					file_data_id = listfile.getByFilename(file_name);

					if (!file_data_id)
						throw new Error('invalid world model path: ' + file_name);
				} else {
					if (placement.id === 0)
						throw new Error('map does not define a valid world model.');

					file_data_id = placement.id;
					file_name = listfile.getByID(file_data_id) || 'unknown_' + file_data_id + '.wmo';
				}

				const mark_file_name = ExportHelper.replaceExtension(file_name, '.obj');
				const export_path = ExportHelper.getExportPath(mark_file_name);

				const data = await this.$core.view.casc.getFile(file_data_id);
				const wmo = new WMOExporter(data, file_data_id);

				wmo.setDoodadSetMask({ [placement.doodadSetIndex]: { checked: true } });
				await wmo.exportAsOBJ(export_path, helper);

				if (helper.isCancelled())
					return;

				helper.mark(mark_file_name, true);
			} catch (e) {
				helper.mark('world model', false, e.message, e.stack);
			}

			WMOExporter.clearCache();
			helper.finish();
		},

		async export_map_wmo_minimap() {
			const helper = new ExportHelper(1, 'minimap');
			helper.start();

			try {
				// use cached minimap data if available, otherwise load it
				let minimap_data = current_wmo_minimap;

				if (!minimap_data) {
					if (!selected_wdt || !selected_wdt.worldModelPlacement)
						throw new Error('map does not contain a world model.');

					await this.setup_wmo_minimap(selected_wdt);
					minimap_data = current_wmo_minimap;

					if (!minimap_data)
						throw new Error('no minimap textures found for this WMO.');
				}

				const { tiles_by_coord, canvas_width, canvas_height, output_tile_size } = minimap_data;

				log.write('WMO minimap export: %d tile positions, %dx%d pixels', tiles_by_coord.size, canvas_width, canvas_height);

				const writer = new TiledPNGWriter(canvas_width, canvas_height, output_tile_size);

				for (const [key, tile_list] of tiles_by_coord) {
					if (helper.isCancelled())
						break;

					try {
						const composite = document.createElement('canvas');
						composite.width = output_tile_size;
						composite.height = output_tile_size;

						const ctx = composite.getContext('2d');

						for (const tile of tile_list) {
							const blp_data = await this.$core.view.casc.getFile(tile.fileDataID);
							const blp = new BLPFile(blp_data);
							const canvas = blp.toCanvas(0b1111);

							const draw_x = tile.drawX;
							const draw_y = tile.drawY;
							const draw_width = canvas.width * tile.scaleX;
							const draw_height = canvas.height * tile.scaleY;

							ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, draw_x, draw_y, draw_width, draw_height);
						}

						const image_data = ctx.getImageData(0, 0, output_tile_size, output_tile_size);

						const [rel_x, rel_y] = key.split(',').map(Number);
						writer.addTile(rel_x, rel_y, image_data);
					} catch (e) {
						log.write('failed to load WMO minimap tile at %s: %s', key, e.message);
					}
				}

				const filename = `${selected_map_dir}_wmo_minimap.png`;
				const relative_path = path.join('maps', selected_map_dir, filename);
				const out_path = ExportHelper.getExportPath(relative_path);

				await writer.write(out_path);

				const export_paths = this.$core.openLastExportStream();
				await export_paths?.writeLine('png:' + out_path);
				export_paths?.close();

				helper.mark(relative_path, true);
				log.write('WMO minimap exported: %s', out_path);

			} catch (e) {
				helper.mark('WMO minimap', false, e.message, e.stack);
			}

			helper.finish();
		},

		async export_map() {
			const format = this.$core.view.config.exportMapFormat;
			if (format === 'OBJ')
				await this.export_selected_map();
			else if (format === 'PNG')
				await this.export_selected_map_as_png();
			else if (format === 'RAW')
				await this.export_selected_map_as_raw();
			else if (format === 'HEIGHTMAPS')
				await this.export_selected_map_as_heightmaps();
		},

		async export_selected_map() {
			const export_tiles = this.$core.view.mapViewerSelection;
			const export_quality = this.$core.view.config.exportMapQuality;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			const helper = new ExportHelper(export_tiles.length, 'tile');
			helper.start();

			const dir = ExportHelper.getExportPath(path.join('maps', selected_map_dir));
			const export_paths = this.$core.openLastExportStream();
			const mark_path = path.join('maps', selected_map_dir, selected_map_dir);

			for (const index of export_tiles) {
				if (helper.isCancelled())
					break;

				const adt = new ADTExporter(selected_map_id, selected_map_dir, index);

				let game_objects = undefined;
				if (this.$core.view.config.mapsIncludeGameObjects === true) {
					const start_x = MAP_OFFSET - (adt.tileX * TILE_SIZE) - TILE_SIZE;
					const start_y = MAP_OFFSET - (adt.tileY * TILE_SIZE) - TILE_SIZE;
					const end_x = start_x + TILE_SIZE;
					const end_y = start_y + TILE_SIZE;

					game_objects = await collect_game_objects(selected_map_id, obj => {
						const [posX, posY] = obj.Pos;
						return posX > start_x && posX < end_x && posY > start_y && posY < end_y;
					});
				}

				try {
					const out = await adt.export(dir, export_quality, game_objects, helper);
					await export_paths?.writeLine(out.type + ':' + out.path);
					helper.mark(mark_path, true);
				} catch (e) {
					helper.mark(mark_path, false, e.message, e.stack);
				}
			}

			export_paths?.close();
			ADTExporter.clearCache();
			helper.finish();
		},

		async export_selected_map_as_raw() {
			const export_tiles = this.$core.view.mapViewerSelection;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			const helper = new ExportHelper(export_tiles.length, 'tile');
			helper.start();

			const dir = ExportHelper.getExportPath(path.join('maps', selected_map_dir));
			const export_paths = this.$core.openLastExportStream();
			const mark_path = path.join('maps', selected_map_dir, selected_map_dir);

			for (const index of export_tiles) {
				if (helper.isCancelled())
					break;

				const adt = new ADTExporter(selected_map_id, selected_map_dir, index);

				try {
					const out = await adt.export(dir, 0, undefined, helper);
					await export_paths?.writeLine(out.type + ':' + out.path);
					helper.mark(mark_path, true);
				} catch (e) {
					helper.mark(mark_path, false, e.message, e.stack);
				}
			}

			export_paths?.close();
			ADTExporter.clearCache();
			helper.finish();
		},

		async export_selected_map_as_png() {
			const export_tiles = this.$core.view.mapViewerSelection;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

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

				const first_tile = await load_map_tile(tile_coords[0].x, tile_coords[0].y, 512);
				if (!first_tile)
					throw new Error('unable to load first tile to determine tile size');

				const tile_size = first_tile.width;
				log.write('detected tile size: %dx%d pixels', tile_size, tile_size);

				const tiles_wide = (max_x - min_x) + 1;
				const tiles_high = (max_y - min_y) + 1;
				const final_width = tiles_wide * tile_size;
				const final_height = tiles_high * tile_size;

				log.write('PNG canvas %dx%d pixels (%d x %d tiles)', final_width, final_height, tiles_wide, tiles_high);

				const writer = new TiledPNGWriter(final_width, final_height, tile_size);

				for (const tile_coord of tile_coords) {
					if (helper.isCancelled())
						break;

					const tile_data = await load_map_tile(tile_coord.x, tile_coord.y, tile_size);

					if (tile_data) {
						const rel_x = tile_coord.x - min_x;
						const rel_y = tile_coord.y - min_y;

						writer.addTile(rel_x, rel_y, tile_data);
						log.write('added tile %d,%d at position %d,%d', tile_coord.x, tile_coord.y, rel_x, rel_y);
						helper.mark(`Tile ${tile_coord.x} ${tile_coord.y}`, true);
					} else {
						log.write('failed to load tile %d,%d, leaving gap', tile_coord.x, tile_coord.y);
						helper.mark(`Tile ${tile_coord.x} ${tile_coord.y}`, false, 'Tile not available');
					}
				}

				const sorted_tiles = [...export_tiles].sort((a, b) => a - b);
				const tile_hash = crypto.createHash('md5').update(sorted_tiles.join(',')).digest('hex').substring(0, 8);

				const filename = `${selected_map_dir}_${tile_hash}.png`;
				const out_path = ExportHelper.getExportPath(path.join('maps', selected_map_dir, filename));

				await writer.write(out_path);

				const stats = writer.getStats();
				log.write('map export complete: %s (%d tiles)', out_path, stats.totalTiles);

				const export_paths = this.$core.openLastExportStream();
				await export_paths?.writeLine('png:' + out_path);
				export_paths?.close();

				helper.mark(path.join('maps', selected_map_dir, filename), true);

			} catch (e) {
				helper.mark('PNG export', false, e.message, e.stack);
				log.write('PNG export failed: %s', e.message);
			}

			helper.finish();
		},

		async initialize() {
			this.$core.showLoadingScreen(3);
			await this.$core.progressLoadingScreen('Loading WMO minimap textures...');

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

			await this.$core.progressLoadingScreen('Loading maps...');

			const maps = [];
			for (const [id, entry] of await db2.Map.getAllRows()) {
				const wdt_path = `world/maps/${entry.Directory}/${entry.Directory}.wdt`;

				if (entry.WdtFileDataID) {
					if (!listfile.existsByID(entry.WdtFileDataID))
						listfile.addEntry(entry.WdtFileDataID, wdt_path);

					maps.push(util.format('%d\x19[%d]\x19%s\x19(%s)', entry.ExpansionID, id, entry.MapName_lang, entry.Directory));
				} else if (listfile.getByFilename(wdt_path)) {
					maps.push(util.format('%d\x19[%d]\x19%s\x19(%s)', entry.ExpansionID, id, entry.MapName_lang, entry.Directory));
				}
			}

			this.$core.view.mapViewerMaps = maps;
			this.$core.hideLoadingScreen();
		},

		async export_selected_map_as_heightmaps() {
			const export_tiles = this.$core.view.mapViewerSelection;
			let export_resolution = this.$core.view.config.heightmapResolution;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			if (export_resolution === -1)
				export_resolution = this.$core.view.config.heightmapCustomResolution;

			if (export_resolution <= 0)
				return this.$core.setToast('error', 'Invalid heightmap resolution selected.', null, -1);

			const dir = ExportHelper.getExportPath(path.join('maps', selected_map_dir, 'heightmaps'));
			const export_paths = this.$core.openLastExportStream();

			this.$core.setToast('progress', 'Calculating height range across all tiles...', null, -1, false);
			let global_min_height = Infinity;
			let global_max_height = -Infinity;

			for (let i = 0; i < export_tiles.length; i++) {
				const tile_index = export_tiles[i];

				try {
					const adt = new ADTExporter(selected_map_id, selected_map_dir, tile_index);
					const height_data = await extract_height_data_from_tile(adt, export_resolution);

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

						log.write('tile %d: height range [%f, %f]', tile_index, tile_min, tile_max);
					}
				} catch (e) {
					log.write('failed to extract height data from tile %d: %s', tile_index, e.message);
				}
			}

			if (global_min_height === Infinity || global_max_height === -Infinity) {
				this.$core.hideToast();
				return this.$core.setToast('error', 'No valid height data found in selected tiles', null, -1);
			}

			const height_range = global_max_height - global_min_height;
			log.write('global height range: [%f, %f] (range: %f)', global_min_height, global_max_height, height_range);

			this.$core.hideToast();

			const helper = new ExportHelper(export_tiles.length, 'heightmap');
			helper.start();

			for (let i = 0; i < export_tiles.length; i++) {
				const tile_index = export_tiles[i];

				if (helper.isCancelled())
					break;

				const tile_id = Math.floor(tile_index / constants.GAME.MAP_SIZE) + '_' + (tile_index % constants.GAME.MAP_SIZE);
				const filename = `heightmap_${tile_id}.png`;

				try {
					const adt = new ADTExporter(selected_map_id, selected_map_dir, tile_index);
					const height_data = await extract_height_data_from_tile(adt, export_resolution);

					if (!height_data || !height_data.heights) {
						helper.mark(`heightmap_${tile_id}.png`, false, 'no height data available');
						continue;
					}

					const out_path = path.join(dir, filename);

					const writer = new PNGWriter(export_resolution, export_resolution);
					const bit_depth = this.$core.view.config.heightmapBitDepth;

					if (bit_depth === 32) {
						writer.bytesPerPixel = 4;
						writer.bitDepth = 8;
						writer.colorType = 6;

						const pixel_data = writer.getPixelData();

						for (let j = 0; j < height_data.heights.length; j++) {
							const normalized_height = (height_data.heights[j] - global_min_height) / height_range;
							const float_buffer = new ArrayBuffer(4);
							const float_view = new Float32Array(float_buffer);
							const byte_view = new Uint8Array(float_buffer);
							float_view[0] = normalized_height;

							const pixel_offset = j * 4;
							pixel_data[pixel_offset] = byte_view[0];
							pixel_data[pixel_offset + 1] = byte_view[1];
							pixel_data[pixel_offset + 2] = byte_view[2];
							pixel_data[pixel_offset + 3] = byte_view[3];
						}
					} else if (bit_depth === 16) {
						writer.bytesPerPixel = 2;
						writer.bitDepth = 16;
						writer.colorType = 0;

						const pixel_data = writer.getPixelData();

						for (let j = 0; j < height_data.heights.length; j++) {
							const normalized_height = (height_data.heights[j] - global_min_height) / height_range;
							const gray_value = Math.floor(normalized_height * 65535);
							const pixel_offset = j * 2;

							pixel_data[pixel_offset] = (gray_value >> 8) & 0xFF;
							pixel_data[pixel_offset + 1] = gray_value & 0xFF;
						}
					} else {
						writer.bytesPerPixel = 1;
						writer.bitDepth = 8;
						writer.colorType = 0;

						const pixel_data = writer.getPixelData();

						for (let j = 0; j < height_data.heights.length; j++) {
							const normalized_height = (height_data.heights[j] - global_min_height) / height_range;
							pixel_data[j] = Math.floor(normalized_height * 255);
						}
					}

					await writer.write(out_path);

					await export_paths?.writeLine('png:' + out_path);

					helper.mark(path.join('maps', selected_map_dir, 'heightmaps', filename), true);
					log.write('exported heightmap: %s', out_path);

				} catch (e) {
					helper.mark(filename, false, e.message, e.stack);
					log.write('failed to export heightmap for tile %d: %s', tile_index, e.message);
				}
			}

			export_paths?.close();
			helper.finish();
		}
	},

	async mounted() {
		this.$core.view.mapViewerTileLoader = load_map_tile;

		this.$core.view.$watch('selectionMaps', async selection => {
			const first = selection[0];

			if (!this.$core.view.isBusy && first) {
				const map = parse_map_entry(first);
				if (selected_map_id !== map.id)
					this.load_map(map.id, map.dir);
			}
		});

		await this.initialize();
	}
};
