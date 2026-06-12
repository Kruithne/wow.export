const core = require('../core');
const constants = require('../constants');
const listfile = require('../casc/listfile');
const GLContext = require('../3D/gl/GLContext');
const PerspectiveCamera = require('./PerspectiveCamera');
const FreeCameraControls = require('./FreeCameraControls');
const TerrainRenderer = require('./TerrainRenderer');
const M2Renderer = require('./M2Renderer');
const WMORenderer = require('./WMORenderer');
const LiquidRenderer = require('./LiquidRenderer');
const FogDataProvider = require('./FogDataProvider');
const SkyRenderer = require('./SkyRenderer');
const SkyboxM2Renderer = require('./SkyboxM2Renderer');
const Minimap = require('./Minimap');

const TILE_SIZE = constants.GAME.TILE_SIZE;
const MAP_SIZE = constants.GAME.MAP_SIZE;
const GRID_COLOR = new Float32Array([0x57 / 255, 0xAF / 255, 0xE2 / 255]);
const CHUNK_GRID_COLOR = new Float32Array([0x3D / 255, 0x7A / 255, 0x9E / 255]);

const SECTIONS = [
	{
		id: 'interface',
		label: 'Interface',
		controls: [
			{ type: 'checkbox', key: 'mapViewerShowStats', label: 'Show Technical Stats' },
			{ type: 'checkbox', key: 'mapViewerShowMinimap', label: 'Show Minimap' },
			{ type: 'checkbox', key: 'mapViewerAllowModelSelection', label: 'Allow Model Selection' }
		]
	},
	{
		id: 'rendering',
		label: 'Rendering',
		controls: [
			{ type: 'slider', key: 'mapViewerRenderDistance', label: 'Render Distance', min: 1, max: 256, step: 1 },
			{ type: 'checkbox', key: 'mapViewerShowM2Models', label: 'Show M2 Models' },
			{ type: 'slider', key: 'mapViewerM2RenderDistance', label: 'M2 Render Distance', min: 50, max: 64000, step: 50 },
			{ type: 'checkbox', key: 'mapViewerShowGlobalWMO', label: 'Show Global WMO', visible_data_key: 'has_global_wmo' },
			{ type: 'checkbox', key: 'mapViewerShowWMOModels', label: 'Show WMO Models' },
			{ type: 'checkbox', key: 'mapViewerShowWMODoodads', label: 'Show WMO Doodads' },
			{ type: 'slider', key: 'mapViewerWMORenderDistance', label: 'WMO Render Distance', min: 50, max: 64000, step: 50 },
			{ type: 'checkbox', key: 'mapViewerShowLiquids', label: 'Show Liquids' },
			{ type: 'checkbox', key: 'mapViewerEnableSkybox', label: 'Enable Skybox' },
			{ type: 'color', key: 'mapViewerSkyColor', label: 'Sky Colour', hidden_key: 'mapViewerEnableSkybox' },
			{ type: 'checkbox', key: 'mapViewerEnableLighting', label: 'Enable Lighting' },
			{ type: 'checkbox', key: 'mapViewerFogEnabled', label: 'Enable Fog' },
			{ type: 'slider', data_key: 'time_of_day', label: 'Time of Day', min: 0, max: 2880, step: 1 }
		]
	},
	{
		id: 'terrain',
		label: 'Terrain',
		controls: [
			{ type: 'dropdown', data_key: 'texture_mode', label: 'Texture Mode', options: ['Flat', 'Wireframe', 'Minimap', 'ADT Tex', 'Full'] },
			{ type: 'slider', data_key: 'full_lod_distance', label: 'Tex LoD (chunks)', min: 1, max: 16, step: 1, visible_mode: 'Full' },
			{ type: 'color', key: 'mapViewerTerrainColor', label: 'Terrain Colour', visible_mode: 'Flat' },
			{ type: 'color', key: 'mapViewerWireframeColor', label: 'Wireframe Colour', visible_mode: 'Wireframe' },
			{ type: 'checkbox', key: 'mapViewerWireframeOcclusion', label: 'Depth Occlusion', visible_mode: 'Wireframe' },
			{ type: 'checkbox', data_key: 'render_holes', label: 'Render Holes' },
			{ type: 'checkbox', data_key: 'show_adt_bounds', label: 'Show Tile Bounds' },
			{ type: 'checkbox', data_key: 'show_chunk_bounds', label: 'Show Chunk Bounds' }
		]
	},
	{
		id: 'camera',
		label: 'Camera',
		controls: [
			{ type: 'slider', key: 'mapViewerFlySpeed', label: 'Fly Speed', min: 10, max: 2000, step: 10 }
		]
	}
];

function hex_to_rgb(hex) {
	const r = parseInt(hex.slice(1, 3), 16) / 255;
	const g = parseInt(hex.slice(3, 5), 16) / 255;
	const b = parseInt(hex.slice(5, 7), 16) / 255;
	return new Float32Array([r, g, b]);
}


module.exports = {
	template: `<div class="map-viewer-screen">
		<canvas ref="canvas"></canvas>
		<template v-if="show_ui">
			<div class="map-viewer-hud">
				<div v-if="config.mapViewerShowStats" class="map-viewer-hud-stats">
					<span v-if="map_info" class="map-viewer-status">{{ map_info }}</span>
					<span class="map-viewer-status">{{ status_text }}</span>
					<span v-if="coord_text" class="map-viewer-status">{{ coord_text }}</span>
					<span v-if="selected_model" class="map-viewer-status mv-selected-model">Selected: {{ selected_model.path }} [{{ selected_model.id }}] <span class="mv-go-to-model" @click="go_to_model">Go to Model</span></span>
				</div>
			</div>
			<div class="mv-panel">
				<div v-for="section in sections" :key="section.id" class="mv-panel-section">
					<div class="mv-panel-header" @click="toggle_section(section.id)">
						<span class="mv-panel-arrow" :class="{ open: open_section === section.id }">&#x25B6;</span>
						{{ section.label }}
					</div>
					<div v-if="open_section === section.id" class="mv-panel-body">
						<template v-for="ctrl in section.controls" :key="ctrl.key || ctrl.data_key">
							<div v-if="is_ctrl_visible(ctrl)" class="mv-panel-control">
								<label v-if="ctrl.type === 'checkbox'" class="mv-panel-checkbox-row">
									<input
										type="checkbox"
										:checked="get_ctrl_value(ctrl)"
										@change="set_ctrl_value(ctrl, $event.target.checked)"
									/>
									<span class="mv-panel-label">{{ ctrl.label }}</span>
								</label>
								<template v-else-if="ctrl.type === 'slider'">
									<label class="mv-panel-label">{{ ctrl.label }}</label>
								</template>
								<div v-if="ctrl.type === 'slider'" class="mv-panel-slider-row">
									<input
										type="range"
										class="mv-panel-slider"
										:min="ctrl.min"
										:max="ctrl.max"
										:step="ctrl.step"
										:value="get_ctrl_value(ctrl)"
										@input="set_ctrl_value(ctrl, Number($event.target.value))"
									/>
									<span class="mv-panel-value">{{ format_ctrl_value(ctrl) }}</span>
								</div>
								<div v-if="ctrl.type === 'color'" class="mv-panel-color-row">
									<label class="mv-panel-label">{{ ctrl.label }}</label>
									<div class="mv-panel-color-swatch" :style="{ background: config[ctrl.key] }" @click="open_picker($event)">
										<input
											type="color"
											:value="config[ctrl.key]"
											@input="config[ctrl.key] = $event.target.value"
										/>
									</div>
								</div>
								<div v-if="ctrl.type === 'dropdown'" class="mv-panel-dropdown-row">
									<label class="mv-panel-label">{{ ctrl.label }}</label>
									<select class="mv-panel-dropdown" :value="get_ctrl_value(ctrl)" @change="set_ctrl_value(ctrl, $event.target.value); $event.target.blur()">
										<option v-for="opt in ctrl.options" :key="opt" :value="opt">{{ opt }}</option>
									</select>
								</div>
							</div>
						</template>
					</div>
				</div>
			</div>
			<div v-show="config.mapViewerShowMinimap" ref="minimap_container" class="mv-minimap-container"></div>
			<div class="mv-shortcuts">
				<span class="mv-shortcut"><kbd>Esc</kbd> Exit Map</span>
				<span class="mv-shortcut"><kbd>Alt+Z</kbd> Hide UI</span>
				<span class="mv-shortcut"><kbd>[</kbd> <kbd>]</kbd> Fly Speed</span>
			</div>
		</template>
	</div>`,

	data() {
		return {
			status_text: 'Initializing...',
			map_info: null,
			coord_text: null,
			selected_model: null,
			show_ui: true,
			open_section: null,
			sections: SECTIONS,
			texture_mode: 'ADT Tex',
			full_lod_distance: 12,
			render_holes: true,
			show_adt_bounds: false,
			show_chunk_bounds: false,
			time_of_day: 1440,
			has_global_wmo: false
		};
	},

	computed: {
		config() {
			return core.view.config;
		}
	},

	watch: {
		'config.mapViewerRenderDistance'(val) {
			if (this._terrain)
				this._terrain.set_render_distance(val);
		},

		'config.mapViewerSkyColor'(val) {
			if (this._gl_ctx && !this.config.mapViewerEnableSkybox) {
				const c = hex_to_rgb(val);
				this._gl_ctx.set_clear_color(c[0], c[1], c[2], 1);
			}
		},

		'config.mapViewerEnableSkybox'(val) {
			if (!val && this._gl_ctx) {
				const c = hex_to_rgb(this.config.mapViewerSkyColor);
				this._gl_ctx.set_clear_color(c[0], c[1], c[2], 1);
			}

			// ensure fog provider is loaded for sky color data
			if (val && this._fog_provider && !this._fog_provider.loaded)
				this._fog_provider.load();
		},

		'config.mapViewerTerrainColor'(val) {
			this._terrain_color = hex_to_rgb(val);
		},

		'config.mapViewerWireframeColor'(val) {
			this._wireframe_color = hex_to_rgb(val);
		},


		'config.mapViewerEnableLighting'(val) {
			if (this._terrain)
				this._terrain.lighting_enabled = val;
		},

		'config.mapViewerFogEnabled'(val) {
			if (this._terrain)
				this._terrain.fog_enabled = val;

			if (val && this._fog_provider && !this._fog_provider.loaded)
				this._fog_provider.load();

			// restore sky color when fog disabled (only if skybox is also disabled)
			if (!val && this._gl_ctx && !this.config.mapViewerEnableSkybox) {
				const c = hex_to_rgb(this.config.mapViewerSkyColor);
				this._gl_ctx.set_clear_color(c[0], c[1], c[2], 1);
			}
		},

		'config.mapViewerShowM2Models'(val) {
			if (this._m2_renderer)
				this._m2_renderer.set_enabled(val);
		},

		'config.mapViewerM2RenderDistance'(val) {
			if (this._m2_renderer)
				this._m2_renderer.set_render_distance(val);
		},

		'config.mapViewerShowGlobalWMO'(val) {
			if (this._wmo_renderer)
				this._wmo_renderer.set_global_enabled(val);
		},

		'config.mapViewerShowWMOModels'(val) {
			if (this._wmo_renderer)
				this._wmo_renderer.set_enabled(val);
		},

		'config.mapViewerShowWMODoodads'(val) {
			if (this._wmo_renderer)
				this._wmo_renderer.set_doodads_enabled(val);
		},

		'config.mapViewerWMORenderDistance'(val) {
			if (this._wmo_renderer)
				this._wmo_renderer.set_render_distance(val);
		},

		'config.mapViewerShowLiquids'(val) {
			if (this._liquid_renderer) {
				this._liquid_renderer.set_enabled(val);
				if (val)
					this._init_liquid_db();
			}
		},

		show_ui(val) {
			if (val)
				this.$nextTick(() => this._init_minimap());
			else
				this._dispose_minimap();
		},

		'config.mapViewerShowMinimap'(val) {
			if (val)
				this._init_minimap();
			else
				this._dispose_minimap();
		},

		texture_mode(val) {
			if (this._terrain)
				this._terrain.set_texture_mode(val);
		},

		full_lod_distance(val) {
			if (this._terrain)
				this._terrain.set_full_lod_distance(val);
		},

		render_holes(val) {
			if (this._terrain)
				this._terrain.render_holes = val;
		}
	},

	async mounted() {
		this._init_gl();
		this._init_camera();
		this._start_render_loop();

		this._key_handler = e => {
			if (e.key === 'Escape')
				this.close();
			else if (e.altKey && e.key === 'z')
				this.show_ui = !this.show_ui;
			else if (e.key === '[')
				core.view.config.mapViewerFlySpeed = Math.max(10, core.view.config.mapViewerFlySpeed - 10);
			else if (e.key === ']')
				core.view.config.mapViewerFlySpeed = Math.min(2000, core.view.config.mapViewerFlySpeed + 10);
		};
		document.addEventListener('keydown', this._key_handler);

		await this._init_terrain();

		this._controls.on_click = (cx, cy) => this._on_canvas_click(cx, cy);
	},

	beforeUnmount() {
		this._stop_render_loop();
		document.removeEventListener('keydown', this._key_handler);
		this._cleanup();
	},

	methods: {
		close() {
			core.view.mapViewerActive = false;
		},

		toggle_section(id) {
			this.open_section = this.open_section === id ? null : id;
		},

		open_picker(e) {
			e.currentTarget.querySelector('input[type="color"]').click();
		},

		is_ctrl_visible(ctrl) {
			if (ctrl.hidden_key && this.config[ctrl.hidden_key])
				return false;

			if (ctrl.visible_data_key && !this[ctrl.visible_data_key])
				return false;

			if (!ctrl.visible_mode)
				return true;

			return ctrl.visible_mode === this.texture_mode;
		},

		get_ctrl_value(ctrl) {
			if (ctrl.data_key)
				return this[ctrl.data_key];

			return this.config[ctrl.key];
		},

		format_ctrl_value(ctrl) {
			const val = this.get_ctrl_value(ctrl);
			if (ctrl.data_key === 'time_of_day') {
				const hours = Math.floor(val / 120);
				const minutes = Math.floor((val % 120) / 2);
				return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
			}
			return val;
		},

		set_ctrl_value(ctrl, value) {
			if (ctrl.data_key)
				this[ctrl.data_key] = value;
			else
				this.config[ctrl.key] = value;
		},

		_init_gl() {
			const canvas = this.$refs.canvas;
			const dpr = window.devicePixelRatio || 1;
			canvas.width = canvas.clientWidth * dpr;
			canvas.height = canvas.clientHeight * dpr;

			this._gl_ctx = new GLContext(canvas, {
				antialias: true,
				alpha: false,
				preserveDrawingBuffer: false
			});

			this._gl_ctx.set_viewport(canvas.width, canvas.height);

			const sky = hex_to_rgb(core.view.config.mapViewerSkyColor);
			this._gl_ctx.set_clear_color(sky[0], sky[1], sky[2], 1);
			this._terrain_color = hex_to_rgb(core.view.config.mapViewerTerrainColor);
			this._wireframe_color = hex_to_rgb(core.view.config.mapViewerWireframeColor);

			this._gl_ctx.set_depth_test(true);

			this._resize_handler = () => {
				const dpr = window.devicePixelRatio || 1;
				canvas.width = canvas.clientWidth * dpr;
				canvas.height = canvas.clientHeight * dpr;
				this._gl_ctx.set_viewport(canvas.width, canvas.height);
				this._camera.aspect = canvas.width / canvas.height;
				this._camera.update_projection();
			};
			window.addEventListener('resize', this._resize_handler);
		},

		_init_camera() {
			const canvas = this.$refs.canvas;
			this._camera = new PerspectiveCamera(60, canvas.width / canvas.height, 1, 100000);
			this._controls = new FreeCameraControls(this._camera, canvas, () => core.view.config.mapViewerFlySpeed);
		},

		_start_render_loop() {
			this._rendering = true;
			this._last_time = performance.now() * 0.001;

			const frame = () => {
				if (!this._rendering)
					return;

				const now = performance.now() * 0.001;
				const dt = Math.min(now - this._last_time, 0.1);
				this._last_time = now;

				this._controls.update(dt);
				this._gl_ctx.clear(true, true);

				if (this._terrain) {
					const cam = this._camera.position;
					this._terrain.update(cam);

					// track height above terrain
					const terrain_h = this._terrain.get_height_at(cam[0], cam[2]);
					const ground = terrain_h !== null ? terrain_h : 0;
					this._height_above_terrain = cam[1] - ground;

					// update fog/sky data before rendering
					this._update_fog(cam);

					// render sky dome + M2 skybox before terrain
					if (this._sky_renderer && this.config.mapViewerEnableSkybox)
						this._update_and_render_sky(cam, dt);

					let visible;
					if (this.texture_mode === 'Wireframe') {
						const sky = hex_to_rgb(core.view.config.mapViewerSkyColor);
						visible = this._terrain.render_wireframe(this._camera.view_matrix, this._camera.projection_matrix, this._wireframe_color, sky, core.view.config.mapViewerWireframeOcclusion);
					} else if (this.texture_mode === 'Minimap') {
						visible = this._terrain.render_minimap(this._camera.view_matrix, this._camera.projection_matrix);
					} else if (this.texture_mode === 'ADT Tex') {
						visible = this._terrain.render_adt_tex(this._camera.view_matrix, this._camera.projection_matrix);
					} else if (this.texture_mode === 'Full') {
						visible = this._terrain.render_full(this._camera.view_matrix, this._camera.projection_matrix);
					} else {
						visible = this._terrain.render(this._camera.view_matrix, this._camera.projection_matrix, this._terrain_color);
					}
					if (this.show_chunk_bounds)
						this._terrain.render_chunk_grid(this._camera.view_matrix, this._camera.projection_matrix, CHUNK_GRID_COLOR);

					if (this.show_adt_bounds)
						this._terrain.render_grid(this._camera.view_matrix, this._camera.projection_matrix, GRID_COLOR);

					// build shared scene params for sub-renderers
					const scene_params = {
						camera_pos: this._terrain.camera_pos,
						light_uniforms: this._terrain.light_uniforms,
						lighting_enabled: this._terrain.lighting_enabled,
						fog_uniforms: this._terrain.fog_enabled ? this._terrain.fog_uniforms : null,
						liquid_colors: this._terrain.liquid_colors
					};

					// liquids
					let liquid_drawn = 0;
					if (this._liquid_renderer) {
						this._liquid_renderer.update();

						liquid_drawn = this._liquid_renderer.render(
							this._camera.view_matrix, this._camera.projection_matrix,
							scene_params
						);
						this._gl_ctx.set_depth_test(true);
					}

					// wmo models (render before M2 so opaque buildings are in depth buffer)
					let wmo_drawn = 0;
					if (this._wmo_renderer) {
						this._wmo_renderer.update(cam);

						wmo_drawn = this._wmo_renderer.render(
							this._camera.view_matrix, this._camera.projection_matrix,
							scene_params
						);
						this._gl_ctx.set_depth_test(true);

						this._wmo_renderer.render_selection(this._camera.view_matrix, this._camera.projection_matrix);
					}

					// m2 models
					let m2_drawn = 0;
					if (this._m2_renderer) {
						this._m2_renderer.update(cam, dt);

						m2_drawn = this._m2_renderer.render(
							this._camera.view_matrix, this._camera.projection_matrix,
							scene_params
						);
						this._gl_ctx.set_depth_test(true);

						this._m2_renderer.render_selection(this._camera.view_matrix, this._camera.projection_matrix);
					}

					const loaded = this._terrain.tile_count;
					const loading = this._terrain.loading_count;
					let status = loaded + ' ADT (' + loading + ' queued), render (' + visible + '/' + this._terrain.chunk_count + ')';

					if (this._liquid_renderer && liquid_drawn > 0)
						status += ' | Liquid: ' + liquid_drawn;

					if (this._wmo_renderer) {
						const wmo_models = this._wmo_renderer.model_count;
						const wmo_loading = this._wmo_renderer.loading_count;
						status += ' | WMO: ' + wmo_drawn + ' inst, ' + wmo_models + ' models';
						if (wmo_loading > 0)
							status += ' (' + wmo_loading + ' loading)';
					}

					if (this._m2_renderer) {
						const m2_models = this._m2_renderer.model_count;
						const m2_loading = this._m2_renderer.loading_count;
						status += ' | M2: ' + m2_drawn + ' inst, ' + m2_models + ' models';
						if (m2_loading > 0)
							status += ' (' + m2_loading + ' loading)';
					}

					this.status_text = status;

					const adt_x = Math.floor(32 - cam[2] / TILE_SIZE);
					const adt_y = Math.floor(32 - cam[0] / TILE_SIZE);
					this.coord_text = 'X: ' + cam[0].toFixed(1) + ' Y: ' + cam[2].toFixed(1) + ' Z: ' + cam[1].toFixed(1) + ' [' + adt_x + ', ' + adt_y + ']';

					// update minimap
					if (this._minimap && core.view.config.mapViewerShowMinimap) {
						this._minimap.set_loaded_tiles(this._terrain.loaded_tiles);
						this._minimap.set_camera(cam[0], cam[2]);
						this._minimap.draw();
					}
				}

				requestAnimationFrame(frame);
			};

			requestAnimationFrame(frame);
		},

		_stop_render_loop() {
			this._rendering = false;
		},

		async _init_terrain() {
			const map_dir = core.view.mapViewerMapDir;
			if (!map_dir) {
				this.status_text = 'No map selected';
				return;
			}

			const map_name = core.view.mapViewerMapName;
			const map_id = core.view.mapViewerMapId;

			if (map_name && map_id != null)
				this.map_info = map_name + ' (' + map_dir + ') [' + map_id + ']';
			else
				this.map_info = map_dir;

			const terrain = new TerrainRenderer(this._gl_ctx);

			try {
				this.status_text = 'Loading WDT...';
				await terrain.init(map_dir);
				terrain.set_render_distance(core.view.config.mapViewerRenderDistance);

				const m2 = new M2Renderer(this._gl_ctx);
				m2.set_enabled(core.view.config.mapViewerShowM2Models);
				m2.set_render_distance(core.view.config.mapViewerM2RenderDistance);

				const wmo = new WMORenderer(this._gl_ctx);
				wmo.set_m2_renderer(m2);
				wmo.set_enabled(core.view.config.mapViewerShowWMOModels);
				wmo.set_doodads_enabled(core.view.config.mapViewerShowWMODoodads);
				wmo.set_render_distance(core.view.config.mapViewerWMORenderDistance);

				const liquid = new LiquidRenderer(this._gl_ctx);
				liquid.set_enabled(core.view.config.mapViewerShowLiquids);

				terrain._on_tile_load = (key, info, liquid_chunks, chunk_positions) => {
					m2.on_tile_loaded(key, info);
					wmo.on_tile_loaded(key, info);
					if (liquid_chunks)
						liquid.on_tile_loaded(key, liquid_chunks, chunk_positions);
				};
				terrain._on_tile_unload = (key) => {
					m2.on_tile_unloaded(key);
					wmo.on_tile_unloaded(key);
					liquid.on_tile_unloaded(key);
				};

				// load global WMO if present
				const global_wmo = core.view.mapViewerGlobalWMO;
				if (global_wmo) {
					this.has_global_wmo = true;

					wmo.load_global_wmo(global_wmo.file_data_id, global_wmo.placement);
					wmo.set_global_enabled(core.view.config.mapViewerShowGlobalWMO);

					// position camera from WMO placement instead of terrain center
					const pos = global_wmo.placement.position;
					terrain.map_center = [
						constants.GAME.MAP_COORD_BASE - pos[0],
						pos[1],
						constants.GAME.MAP_COORD_BASE - pos[2]
					];
				}

				this._m2_renderer = m2;
				this._wmo_renderer = wmo;
				this._liquid_renderer = liquid;
				this._terrain = terrain;

				// sky renderer
				this._sky_renderer = new SkyRenderer(this._gl_ctx);
				this._skybox_m2 = new SkyboxM2Renderer(this._gl_ctx);

				// fog/sky/lighting data provider (shared DB2 tables)
				this._fog_provider = new FogDataProvider(map_id);
				this._fog_provider.load();

				this._apply_initial_settings();
				this._position_camera();
				this._init_minimap();
				this._init_liquid_db();
			} catch (e) {
				this.status_text = 'Error: ' + e.message;
				terrain.dispose();
			}
		},

		_apply_initial_settings() {
			if (!this._terrain)
				return;

			this._terrain.fog_enabled = this.config.mapViewerFogEnabled;
			this._terrain.lighting_enabled = this.config.mapViewerEnableLighting;
		},

		_update_fog(cam) {
			const needs_fog = this._terrain.fog_enabled;
			const needs_sky = this.config.mapViewerEnableSkybox;

			if (!this._fog_provider || !this._fog_provider.loaded)
				return;

			this._fog_provider.time_of_day = this.time_of_day;
			this._fog_provider.update(cam);

			// always apply DB2-driven lighting + liquid colors
			this._terrain.light_uniforms = this._fog_provider.light_uniforms;
			this._terrain.liquid_colors = this._fog_provider.liquid_colors;

			// inject sun direction from lighting into fog uniforms
			const light_dir = this._fog_provider.light_uniforms.light_dir;

			if (needs_fog) {
				const uniforms = this._fog_provider.fog_uniforms;

				uniforms.sun_dir_z_scalar[0] = light_dir[0];
				uniforms.sun_dir_z_scalar[1] = light_dir[1];
				uniforms.sun_dir_z_scalar[2] = light_dir[2];

				this._terrain.fog_uniforms = uniforms;

				// update clear color to match fog when fog is enabled (skybox handles its own colors)
				if (!needs_sky && uniforms.enabled > 0.5) {
					const fog_color = uniforms.color_height_rate;
					this._gl_ctx.set_clear_color(fog_color[0], fog_color[1], fog_color[2], 1);
				}
			}
		},

		_update_and_render_sky(cam, dt) {
			if (!this._fog_provider || !this._fog_provider.loaded)
				return;

			const sky_colors = this._fog_provider.sky_colors;
			this._sky_renderer.set_sky_colors(sky_colors);

			// set clear color to fog/horizon color so gaps blend naturally
			const horizon = sky_colors[5];
			this._gl_ctx.set_clear_color(horizon[0], horizon[1], horizon[2], 1);

			this._sky_renderer.render(this._camera.view_matrix, this._camera.projection_matrix);

			// render M2 skybox model on top of procedural dome
			if (this._skybox_m2) {
				const skybox_info = this._fog_provider.skybox_info;
				if (skybox_info)
					this._skybox_m2.set_model(skybox_info.file_data_id, skybox_info.flags);
				else
					this._skybox_m2.set_model(0, 0);

				this._skybox_m2.update(cam, dt, this.time_of_day);
				this._skybox_m2.render(this._camera.view_matrix, this._camera.projection_matrix);
			}
		},

		_position_camera() {
			const selection = core.view.mapViewerSelection;
			let target_x, target_z;

			if (selection.length > 0) {
				const index = selection[selection.length - 1];
				const wdt_x = index % MAP_SIZE;
				const wdt_y = Math.floor(index / MAP_SIZE);

				target_x = (31.5 - wdt_y) * TILE_SIZE;
				target_z = (31.5 - wdt_x) * TILE_SIZE;
			} else {
				const center = this._terrain.map_center;
				target_x = center[0];
				target_z = center[2];
			}

			this._camera.position[0] = target_x;
			this._camera.position[1] = 500;
			this._camera.position[2] = target_z;
			this._controls.pitch = -0.6;
			this._controls.yaw = 0;
			this._height_above_terrain = 500;
		},

		_init_minimap() {
			if (!this.$refs.minimap_container || !this._terrain || !core.view.config.mapViewerShowMinimap)
				return;

			this._minimap = new Minimap(this.$refs.minimap_container);
			this._minimap.set_tile_info(this._terrain.tile_info);

			this._minimap.set_move_callback((world_x, world_z) => {
				const cam = this._camera.position;

				// compute height above terrain at new position
				const terrain_h = this._terrain.get_height_at(world_x, world_z);
				const ground = terrain_h !== null ? terrain_h : 0;

				cam[0] = world_x;
				cam[1] = ground + this._height_above_terrain;
				cam[2] = world_z;
			});
		},

		async _init_liquid_db() {
			if (!this._liquid_renderer || !core.view.config.mapViewerShowLiquids)
				return;

			await this._liquid_renderer._ensure_db();
		},

		_dispose_minimap() {
			if (this._minimap) {
				this._minimap.dispose();
				this._minimap = null;
			}
		},

		_on_canvas_click(cx, cy) {
			if (!core.view.config.mapViewerAllowModelSelection)
				return;

			const canvas = this.$refs.canvas;
			const rect = canvas.getBoundingClientRect();

			// normalized device coords [-1, 1]
			const ndc_x = ((cx - rect.left) / rect.width) * 2 - 1;
			const ndc_y = 1 - ((cy - rect.top) / rect.height) * 2;

			const ray = this._unproject_ray(ndc_x, ndc_y);

			// pick closest hit across M2 and WMO
			const m2_hit = this._m2_renderer?.pick(ray.origin, ray.dir);
			const wmo_hit = this._wmo_renderer?.pick(ray.origin, ray.dir);

			let hit = null;
			let source = null;

			if (m2_hit && wmo_hit)
				hit = m2_hit.t <= wmo_hit.t ? (source = 'm2', m2_hit) : (source = 'wmo', wmo_hit);
			else if (m2_hit)
				hit = (source = 'm2', m2_hit);
			else if (wmo_hit)
				hit = (source = 'wmo', wmo_hit);

			// deselect the renderer that didn't win
			if (source !== 'm2' && this._m2_renderer)
				this._m2_renderer.deselect();

			if (source !== 'wmo' && this._wmo_renderer)
				this._wmo_renderer.deselect();

			if (hit) {
				const filename = listfile.getByIDOrUnknown(hit.file_data_id);
				this.selected_model = { id: hit.file_data_id, path: filename };
			} else {
				this.selected_model = null;
			}
		},

		_unproject_ray(ndc_x, ndc_y) {
			const proj = this._camera.projection_matrix;
			const view = this._camera.view_matrix;

			// invert projection (only diagonal elements needed for direction)
			const eye_x = ndc_x / proj[0];
			const eye_y = ndc_y / proj[5];
			const eye_z = -1;

			// invert view matrix: transpose the 3x3 rotation part (multiply by columns)
			const dx = view[0] * eye_x + view[1] * eye_y + view[2] * eye_z;
			const dy = view[4] * eye_x + view[5] * eye_y + view[6] * eye_z;
			const dz = view[8] * eye_x + view[9] * eye_y + view[10] * eye_z;

			const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

			return {
				origin: this._camera.position,
				dir: [dx / len, dy / len, dz / len]
			};
		},

		go_to_model() {
			if (!this.selected_model)
				return;

			const file_data_id = this.selected_model.id;
			const entry = listfile.getByIDOrUnknown(file_data_id);

			core.view.mapViewerActive = false;
			require('../modules').tab_creatures.setActive();

			core.view.userInputFilterModels = '';
			core.view.overrideModelList = [entry];
			core.view.selectionModels = [entry];
			core.view.overrideModelName = null;
		},

		_cleanup() {
			window.removeEventListener('resize', this._resize_handler);
			this._dispose_minimap();

			if (this._controls) {
				this._controls.dispose();
				this._controls = null;
			}

			if (this._sky_renderer) {
				this._sky_renderer.dispose();
				this._sky_renderer = null;
			}

			if (this._skybox_m2) {
				this._skybox_m2.dispose();
				this._skybox_m2 = null;
			}

			if (this._liquid_renderer) {
				this._liquid_renderer.dispose();
				this._liquid_renderer = null;
			}

			if (this._wmo_renderer) {
				this._wmo_renderer.dispose();
				this._wmo_renderer = null;
			}

			if (this._m2_renderer) {
				this._m2_renderer.dispose();
				this._m2_renderer = null;
			}

			if (this._terrain) {
				this._terrain.dispose();
				this._terrain = null;
			}

			if (this._gl_ctx) {
				this._gl_ctx.dispose();
				this._gl_ctx = null;
			}
		}
	}
};
