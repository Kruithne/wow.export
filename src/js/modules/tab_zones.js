const util = require('util');
const core = require('../core');
const log = require('../log');
const path = require('path');
const InstallType = require('../install-type');

const db2 = require('../casc/db2');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');

let selected_zone_id = null;
let selected_phase_id = null;

const parse_zone_entry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('unexpected zone entry');

	return { id: parseInt(match[1]), zone_name: match[2], area_name: match[3] };
};

const get_zone_ui_map_id = async (zone_id) => {
	for (const assignment of (await db2.UiMapAssignment.getAllRows()).values()) {
		if (assignment.AreaID === zone_id)
			return assignment.UiMapID;
	}

	return null;
};

const get_zone_phases = async (zone_id) => {
	const ui_map_id = await get_zone_ui_map_id(zone_id);
	if (!ui_map_id)
		return [];

	const phases = [];
	const seen_phases = new Set();

	for (const link_entry of (await db2.UiMapXMapArt.getAllRows()).values()) {
		if (link_entry.UiMapID === ui_map_id) {
			const phase_id = link_entry.PhaseID ?? 0;
			if (!seen_phases.has(phase_id)) {
				seen_phases.add(phase_id);
				phases.push({
					id: phase_id,
					label: phase_id === 0 ? 'Default' : `Phase ${phase_id}`
				});
			}
		}
	}

	phases.sort((a, b) => a.id - b.id);
	return phases;
};

const render_zone_to_canvas = async (canvas, zone_id, phase_id = null, set_canvas_size = true, skip_zone_check = false) => {
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const ui_map_id = await get_zone_ui_map_id(zone_id);
	if (!ui_map_id) {
		log.write('no UiMap found for zone ID %d', zone_id);
		throw new Error('no map data available for this zone');
	}

	const map_data = await db2.UiMap.getRow(ui_map_id);
	if (!map_data) {
		log.write('UiMap entry not found for ID %d', ui_map_id);
		throw new Error('UiMap entry not found');
	}

	const art_styles = [];

	const linked_art_ids = [];
	for (const link_entry of (await db2.UiMapXMapArt.getAllRows()).values()) {
		if (link_entry.UiMapID === ui_map_id) {
			if (phase_id === null || link_entry.PhaseID === phase_id)
				linked_art_ids.push(link_entry.UiMapArtID);
		}
	}

	for (const art_id of linked_art_ids) {
		const art_entry = await db2.UiMapArt.getRow(art_id);
		if (art_entry) {
			let style_layer;

			for (const art_style_layer of (await db2.UiMapArtStyleLayer.getAllRows()).values()) {
				if (art_style_layer.UiMapArtStyleID === art_entry.UiMapArtStyleID)
					style_layer = art_style_layer;
			}

			if (style_layer) {
				const combined_style = {
					...art_entry,
					LayerIndex: style_layer.LayerIndex,
					LayerWidth: style_layer.LayerWidth,
					LayerHeight: style_layer.LayerHeight,
					TileWidth: style_layer.TileWidth,
					TileHeight: style_layer.TileHeight
				};
				art_styles.push(combined_style);
			} else {
				log.write('no style layer found for UiMapArtStyleID %d', art_entry.UiMapArtStyleID);
			}
		}
	}

	if (art_styles.length === 0) {
		log.write('no art styles found for UiMap ID %d (phase %s)', ui_map_id, phase_id);
		throw new Error('no art styles found for map');
	}

	log.write('found %d art styles for UiMap ID %d (phase %s)', art_styles.length, ui_map_id, phase_id);
	art_styles.sort((a, b) => (a.LayerIndex || 0) - (b.LayerIndex || 0));

	let map_width = 0, map_height = 0;

	for (const art_style of art_styles) {
		const all_tiles = await db2.UiMapArtTile.getRelationRows(art_style.ID);
		if (all_tiles.length === 0) {
			log.write('no tiles found for UiMapArt ID %d', art_style.ID);
			continue;
		}

		const tiles_by_layer = all_tiles.reduce((layers, tile) => {
			const layer_index = tile.LayerIndex || 0;
			if (!layers[layer_index])
				layers[layer_index] = [];

			layers[layer_index].push(tile);
			return layers;
		}, {});

		if (art_style.LayerIndex === 0) {
			map_width = art_style.LayerWidth;
			map_height = art_style.LayerHeight;
			if (set_canvas_size) {
				canvas.width = map_width;
				canvas.height = map_height;
			}
		}

		if(core.view.config.showZoneBaseMap){
			const layer_indices = Object.keys(tiles_by_layer).sort((a, b) => parseInt(a) - parseInt(b));
			for (const layer_index of layer_indices) {
				const layer_tiles = tiles_by_layer[layer_index];
				const layer_num = parseInt(layer_index);

			log.write('rendering layer %d with %d tiles', layer_num, layer_tiles.length);
			await render_map_tiles(ctx, layer_tiles, art_style, layer_num, zone_id, skip_zone_check);
		}

		if (core.view.config.showZoneOverlays)
			await render_world_map_overlays(ctx, art_style, zone_id, skip_zone_check);
	}

	log.write('successfully rendered zone map for zone ID %d (UiMap ID %d)', zone_id, ui_map_id);

	return {
		width: map_width,
		height: map_height,
		ui_map_id: ui_map_id
	};
};

const render_map_tiles = async (ctx, tiles, art_style, layer_index = 0, expected_zone_id, skip_zone_check = false) => {
	tiles.sort((a, b) => {
		if (a.RowIndex !== b.RowIndex)
			return a.RowIndex - b.RowIndex;

		return a.ColIndex - b.ColIndex;
	});

	const tile_promises = tiles.map(async (tile) => {
		try {
			const pixel_x = tile.ColIndex * art_style.TileWidth;
			const pixel_y = tile.RowIndex * art_style.TileHeight;

			const final_x = pixel_x + (tile.OffsetX || 0);
			const final_y = pixel_y + (tile.OffsetY || 0);

			log.write('rendering tile FileDataID %d at position (%d,%d) -> (%d,%d) [Layer %d]',
				tile.FileDataID, tile.ColIndex, tile.RowIndex, final_x, final_y, layer_index);

			const data = await core.view.casc.getFile(tile.FileDataID);
			const blp = new BLPFile(data);

			if (!skip_zone_check && selected_zone_id !== expected_zone_id) {
				log.write('skipping tile render - zone changed from %d to %d', expected_zone_id, selected_zone_id);
				return { success: false, tile: tile, skipped: true };
			}

			const tile_canvas = blp.toCanvas(0b1111);
			ctx.drawImage(tile_canvas, final_x, final_y);

			return { success: true, tile: tile };
		} catch (e) {
			log.write('failed to render tile FileDataID %d: %s', tile.FileDataID, e.message);
			return { success: false, tile: tile, error: e.message };
		}
	});

	const results = await Promise.all(tile_promises);
	const successful = results.filter(r => r.success).length;
	log.write('rendered %d/%d tiles successfully', successful, tiles.length);
};

const render_world_map_overlays = async (ctx, art_style, expected_zone_id, skip_zone_check = false) => {
	const overlays = await db2.WorldMapOverlay.getRelationRows(art_style.ID);
	if (overlays.length === 0) {
		log.write('no WorldMapOverlay entries found for UiMapArt ID %d', art_style.ID);
		return;
	}

	for (const overlay of overlays) {
		const overlay_tiles = await db2.WorldMapOverlayTile.getRelationRows(overlay.ID);
		if (overlay_tiles.length === 0) {
			log.write('no tiles found for WorldMapOverlay ID %d', overlay.ID);
			continue;
		}

		log.write('rendering WorldMapOverlay ID %d with %d tiles at offset (%d,%d)',
			overlay.ID, overlay_tiles.length, overlay.OffsetX, overlay.OffsetY);

		await render_overlay_tiles(ctx, overlay_tiles, overlay, art_style, expected_zone_id, skip_zone_check);
	}
};

const render_overlay_tiles = async (ctx, tiles, overlay, art_style, expected_zone_id, skip_zone_check = false) => {
	tiles.sort((a, b) => {
		if (a.RowIndex !== b.RowIndex)
			return a.RowIndex - b.RowIndex;

		return a.ColIndex - b.ColIndex;
	});

	const tile_promises = tiles.map(async (tile) => {
		try {
			const base_x = overlay.OffsetX + (tile.ColIndex * art_style.TileWidth);
			const base_y = overlay.OffsetY + (tile.RowIndex * art_style.TileHeight);

			log.write('rendering overlay tile FileDataID %d at position (%d,%d) -> (%d,%d)',
				tile.FileDataID, tile.ColIndex, tile.RowIndex, base_x, base_y);

			const data = await core.view.casc.getFile(tile.FileDataID);
			const blp = new BLPFile(data);

			if (!skip_zone_check && selected_zone_id !== expected_zone_id) {
				log.write('skipping overlay tile render - zone changed from %d to %d', expected_zone_id, selected_zone_id);
				return { success: false, tile: tile, skipped: true };
			}

			if (!skip_zone_check && !core.view.config.showZoneOverlays) {
				log.write('skipping overlay tile render - overlays disabled while loading');
				return { success: false, tile: tile, skipped: true };
			}

			const tile_canvas = blp.toCanvas(0b1111);
			ctx.drawImage(tile_canvas, base_x, base_y);

			return { success: true, tile: tile };
		} catch (e) {
			log.write('failed to render overlay tile FileDataID %d: %s', tile.FileDataID, e.message);
			return { success: false, tile: tile, error: e.message };
		}
	});

	const results = await Promise.all(tile_promises);
	const successful = results.filter(r => r.success).length;
	log.write('rendered %d/%d overlay tiles successfully', successful, tiles.length);
};

const load_zone_map = async (zone_id, phase_id = null) => {
	const canvas = document.getElementById('zone-canvas');
	if (!canvas) {
		log.write('zone canvas not found');
		return;
	}

	try {
		await render_zone_to_canvas(canvas, zone_id, phase_id, true);
	} catch (e) {
		log.write('failed to render zone map: %s', e.message);
		core.setToast('error', 'Failed to load map data: ' + e.message);
	}
};

module.exports = {
	register() {
		this.registerNavButton('Zones', 'mountain-castle.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-zones">
			<div class="zone-placeholder">
				<div class="expansion-buttons">
					<button class="expansion-button show-all"
							title="Show All"
							:class="{ active: $core.view.selectedZoneExpansionFilter === -1 }"
							@click="$core.view.selectedZoneExpansionFilter = -1">
					</button>
					<button v-for="expansion in $core.view.constants.EXPANSIONS"
							:key="expansion.id"
							class="expansion-button"
							:title="expansion.name"
							:class="{ active: $core.view.selectedZoneExpansionFilter === expansion.id }"
							@click="$core.view.selectedZoneExpansionFilter = expansion.id"
							:style="'background-image: var(--expansion-icon-' + expansion.id + ')'">
					</button>
				</div>
			</div>
			<div class="list-container">
				<component :is="$components.ListboxZones" id="listbox-zones" class="listbox-icons" v-model:selection="$core.view.selectionZones" :items="$core.view.zoneViewerZones" :filter="$core.view.userInputFilterZones" :expansion-filter="$core.view.selectedZoneExpansionFilter" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="zone" persistscrollkey="zones" @contextmenu="handle_zone_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeZone" v-slot:default="context" @close="$core.view.contextMenus.nodeZone = null">
					<span @click.self="copy_zone_names(context.node.selection)">Copy zone name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_area_names(context.node.selection)">Copy area name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_zone_ids(context.node.selection)">Copy zone ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_zone_export_path()">Copy export path</span>
					<span @click.self="open_zone_export_directory()">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterZones" placeholder="Filter zones..."/>
			</div>
			<div class="zone-export-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.showZoneBaseMap"/>
					<span>Show Base Map</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.showZoneOverlays"/>
					<span>Show Overlays</span>
				</label>
				<input type="button" value="Export Map" @click="export_zone_map" :class="{ disabled: $core.view.isBusy || !$core.view.selectionZones || $core.view.selectionZones.length === 0 }"/>
			</div>
			<div class="zone-viewer-container preview-container">
				<div class="preview-background">
					<div v-if="$core.view.zonePhases && $core.view.zonePhases.length > 1" class="preview-dropdown-overlay">
						<select v-model="$core.view.zonePhaseSelection">
							<option v-for="phase in $core.view.zonePhases" :key="phase.id" :value="phase.id">
								{{ phase.label }}
							</option>
						</select>
					</div>
					<canvas id="zone-canvas"></canvas>
				</div>
			</div>
		</div>
	`,

	methods: {
		handle_zone_context(data) {
			this.$core.view.contextMenus.nodeZone = {
				selection: data.selection,
				count: data.selection.length
			};
		},

		copy_zone_names(selection) {
			const names = selection.map(entry => {
				const zone = parse_zone_entry(entry);
				return zone.zone_name;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_area_names(selection) {
			const names = selection.map(entry => {
				const zone = parse_zone_entry(entry);
				return zone.area_name;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_zone_ids(selection) {
			const ids = selection.map(entry => {
				const zone = parse_zone_entry(entry);
				return zone.id;
			});
			nw.Clipboard.get().set(ids.join('\n'), 'text');
		},

		copy_zone_export_path() {
			const dir = ExportHelper.getExportPath('zones');
			nw.Clipboard.get().set(dir, 'text');
		},

		open_zone_export_directory() {
			const dir = ExportHelper.getExportPath('zones');
			nw.Shell.openItem(dir);
		},

		async export_zone_map() {
			const user_selection = this.$core.view.selectionZones;
			if (!user_selection || user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any zones to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'zone');
			helper.start();

			const format = this.$core.view.config.exportTextureFormat;
			const ext = format === 'WEBP' ? '.webp' : '.png';
			const mime_type = format === 'WEBP' ? 'image/webp' : 'image/png';

			for (const zone_entry of user_selection) {
				if (helper.isCancelled())
					return;

				try {
					const zone = parse_zone_entry(zone_entry);
					const export_canvas = document.createElement('canvas');
					const phase_id = selected_phase_id;

					log.write('exporting zone map: %s (%d) phase %s', zone.zone_name, zone.id, phase_id);

					const map_info = await render_zone_to_canvas(export_canvas, zone.id, phase_id, true, true);

					if (map_info.width === 0 || map_info.height === 0) {
						log.write('no map data available for zone %d, skipping', zone.id);
						helper.mark(`Zone_${zone.id}`, false, 'No map data available');
						continue;
					}

					const normalized_zone_name = zone.zone_name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');
					const normalized_area_name = zone.area_name.replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '_');

					const phase_suffix = phase_id !== null && phase_id !== 0 ? `_Phase${phase_id}` : '';
					const filename = `Zone_${zone.id}_${normalized_zone_name}_${normalized_area_name}${phase_suffix}${ext}`;
					const export_path = ExportHelper.getExportPath(path.join('zones', filename));

					log.write('exporting zone map at full resolution (%dx%d): %s', map_info.width, map_info.height, filename);

					const buf = await BufferWrapper.fromCanvas(export_canvas, mime_type, this.$core.view.config.exportWebPQuality);
					await buf.writeToFile(export_path);

					helper.mark(path.join('zones', filename), true);

					log.write('successfully exported zone map to: %s', export_path);
				} catch (e) {
					log.write('failed to export zone map: %s', e.message);
					helper.mark(zone_entry, false, e.message, e.stack);
				}
			}

			helper.finish();
		}
	},

	async mounted() {
		this.$core.view.$watch('selectionZones', async selection => {
			const first = selection[0];

			if (!this.$core.view.isBusy && first) {
				const zone = parse_zone_entry(first);
				if (selected_zone_id !== zone.id) {
					selected_zone_id = zone.id;
					log.write('selected zone: %s (%d)', zone.zone_name, zone.id);

					const phases = await get_zone_phases(zone.id);
					this.$core.view.zonePhases = phases;

					if (phases.length > 0) {
						selected_phase_id = phases[0].id;
						this.$core.view.zonePhaseSelection = phases[0].id;
					} else {
						selected_phase_id = null;
						this.$core.view.zonePhaseSelection = null;
					}

					await load_zone_map(zone.id, selected_phase_id);
				}
			}
		});

		this.$core.view.$watch('zonePhaseSelection', async (new_value, old_value) => {
			if (new_value !== old_value && selected_zone_id && !this.$core.view.isBusy) {
				selected_phase_id = new_value;
				log.write('zone phase changed to %s, reloading zone %d', new_value, selected_zone_id);
				await load_zone_map(selected_zone_id, selected_phase_id);
			}
		});
		
		this.$core.view.$watch('config.showZoneBaseMap', async (new_value, old_value) => {
			if (new_value !== old_value && selected_zone_id && !this.$core.view.isBusy) {
				log.write('zone base map setting changed, reloading zone %d', selected_zone_id);
				await load_zone_map(selected_zone_id, selected_phase_id);
			}
		});

		this.$core.view.$watch('config.showZoneOverlays', async (new_value, old_value) => {
			if (new_value !== old_value && selected_zone_id && !this.$core.view.isBusy) {
				log.write('zone overlay setting changed, reloading zone %d', selected_zone_id);
				await load_zone_map(selected_zone_id, selected_phase_id);
			}
		});

		try {
			this.$core.showLoadingScreen(3);

			await this.$core.progressLoadingScreen('Loading map tiles...');
			await db2.preload.UiMapArtTile();

			await this.$core.progressLoadingScreen('Loading map overlays...');
			await db2.preload.WorldMapOverlay();
			await db2.preload.WorldMapOverlayTile();

			await this.$core.progressLoadingScreen('Loading zone data...');

			const expansion_map = new Map();
			for (const [id, entry] of await db2.Map.getAllRows())
				expansion_map.set(id, entry.ExpansionID);

			log.write('loaded %d maps for expansion mapping', expansion_map.size);

			const available_zones = new Set();
			for (const entry of (await db2.UiMapAssignment.getAllRows()).values())
				available_zones.add(entry.AreaID);

			log.write('loaded %d zones from UiMapAssignment', available_zones.size);

			const table = db2.AreaTable;

			const zones = [];
			for (const [id, entry] of await table.getAllRows()) {
				const expansion_id = expansion_map.get(entry.ContinentID) || 0;

				if (!available_zones.has(id))
					continue;

				zones.push(
					util.format('%d\x19[%d]\x19%s\x19(%s)',
					expansion_id, id, entry.AreaName_lang, entry.ZoneName)
				);
			}

			this.$core.view.zoneViewerZones = zones;
			log.write('loaded %d zones from AreaTable', zones.length);

			this.$core.hideLoadingScreen();
		} catch (e) {
			this.$core.setToast('error', 'Failed to load zone data: ' + e.message, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('failed to load AreaTable.db2: %s', e.message);

			this.$core.hideLoadingScreen();
		}
	}
};
