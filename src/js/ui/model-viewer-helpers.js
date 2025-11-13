/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const THREE = require('three');
const CameraBounding = require('../3D/camera/CameraBounding');

const init_3d_scene = (show_background, background_color, show_grid) => {
	const camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);
	const scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 3);
	scene.add(light);

	const render_group = new THREE.Group();
	scene.add(render_group);

	if (show_background)
		scene.background = new THREE.Color(background_color);

	const grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);
	if (show_grid)
		scene.add(grid);

	// wow models face wrong direction by default
	render_group.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	return { camera, scene, render_group, grid };
};

const setup_grid_watcher = (scene, grid, config_key = 'config.modelViewerShowGrid') => {
	core.view.$watch(config_key, () => {
		if (core.view.config.modelViewerShowGrid)
			scene.add(grid);
		else
			scene.remove(grid);
	});
};

const setup_background_watchers = (scene, config_show_key = 'config.modelViewerShowBackground', config_color_key = 'config.modelViewerBackgroundColor') => {
	core.view.$watch(config_show_key, () => {
		if (core.view.config.modelViewerShowBackground)
			scene.background = new THREE.Color(core.view.config.modelViewerBackgroundColor);
		else
			scene.background = null;
	});

	core.view.$watch(config_color_key, () => {
		if (core.view.config.modelViewerShowBackground)
			scene.background = new THREE.Color(core.view.config.modelViewerBackgroundColor);
	});
};

const clear_texture_preview = (view_props) => {
	core.view[view_props.preview_url] = '';
	core.view[view_props.preview_uv_overlay] = '';
	core.view[view_props.uv_layers] = [];
};

const init_uv_layers = (active_renderer, view_props) => {
	if (!active_renderer || !active_renderer.getUVLayers) {
		core.view[view_props.uv_layers] = [];
		return;
	}

	const uv_layer_data = active_renderer.getUVLayers();
	core.view[view_props.uv_layers] = [
		{ name: 'UV Off', data: null, active: true },
		...uv_layer_data.layers
	];
};

const toggle_uv_layer = (layer_name, active_renderer, view_props) => {
	const layer = core.view[view_props.uv_layers].find(l => l.name === layer_name);
	if (!layer)
		return;

	core.view[view_props.uv_layers].forEach(l => {
		l.active = (l === layer);
	});

	if (layer_name === 'UV Off' || !layer.data) {
		core.view[view_props.preview_uv_overlay] = '';
	} else if (active_renderer && active_renderer.getUVLayers) {
		const uv_drawer = require('./uv-drawer');
		const uv_layer_data = active_renderer.getUVLayers();
		const overlay_data_url = uv_drawer.generateUVLayerDataURL(
			layer.data,
			core.view[view_props.preview_width],
			core.view[view_props.preview_height],
			uv_layer_data.indices
		);
		core.view[view_props.preview_uv_overlay] = overlay_data_url;
	}
};

const fit_camera = (render_group, camera, controls) => {
	CameraBounding.fitObjectInView(render_group, camera, controls);
};

module.exports = {
	init_3d_scene,
	setup_grid_watcher,
	setup_background_watchers,
	clear_texture_preview,
	init_uv_layers,
	toggle_uv_layer,
	fit_camera
};
