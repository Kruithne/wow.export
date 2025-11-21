/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const path = require('path');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const constants = require('../constants');
const BLPFile = require('../casc/blp');

const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');

const WMORenderer = require('../3D/renderers/WMORenderer');
const WMOExporter = require('../3D/exporters/WMOExporter');

const textureRibbon = require('./texture-ribbon');
const textureExporter = require('./texture-exporter');
const AnimMapper = require('../3D/AnimMapper');
const modelHelpers = require('./model-viewer-helpers');

const MODEL_TYPE_M2 = Symbol('modelM2');
const MODEL_TYPE_WMO = Symbol('modelWMO');

const export_extensions = {
	'OBJ': '.obj',
	'GLTF': '.gltf',
	'GLB': '.glb'
};

const active_skins = new Map();
let selected_variant_textures = [];
let selected_skin_name = null;

let camera, scene, grid;
const render_group = new THREE.Group();

let active_renderer;
let active_path;

const get_file_name_from_display = (display_path) => {
	// strip mpq prefix: "patch.mpq\path\to\file.ext" -> "path\to\file.ext"
	const parts = display_path.split('\\');
	if (parts.length > 1 && parts[0].toLowerCase().endsWith('.mpq'))
		return parts.slice(1).join('\\');

	return display_path;
};

const preview_texture_by_path = async (texture_path, display_name) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('loading %s, please wait...', display_name), null, -1, false);
	log.write('previewing texture file %s', texture_path);

	try {
		const data = core.view.mpq.getFile(texture_path);
		if (!data)
			throw new Error('failed to load texture');

		const buffer = Buffer.from(data);
		const wrapped = new BufferWrapper(buffer);
		const blp = new BLPFile(wrapped);

		core.view.legacyModelTexturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
		core.view.legacyModelTexturePreviewWidth = blp.width;
		core.view.legacyModelTexturePreviewHeight = blp.height;
		core.view.legacyModelTexturePreviewName = display_name;

		modelHelpers.init_uv_layers(active_renderer, {
			uv_layers: 'legacyModelViewerUVLayers',
			preview_width: 'legacyModelTexturePreviewWidth',
			preview_height: 'legacyModelTexturePreviewHeight',
			preview_uv_overlay: 'legacyModelTexturePreviewUVOverlay'
		});

		core.hideToast();
	} catch (e) {
		core.setToast('error', 'unable to preview texture ' + display_name, { 'view log': () => log.openRuntimeLog() }, -1);
		log.write('failed to open texture file: %s', e.message);
	}

	core.view.isBusy--;
};

const preview_model = async (display_path) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('loading %s, please wait...', display_path), null, -1, false);
	log.write('previewing model %s', display_path);

	textureRibbon.reset();
	modelHelpers.clear_texture_preview({
		preview_url: 'legacyModelTexturePreviewURL',
		preview_uv_overlay: 'legacyModelTexturePreviewUVOverlay',
		uv_layers: 'legacyModelViewerUVLayers'
	});

	core.view.legacyModelViewerSkins = [];
	core.view.legacyModelViewerSkinsSelection = [];
	core.view.legacyModelViewerAnims = [];
	core.view.legacyModelViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = null;
			active_path = null;
		}

		active_skins.clear();
		selected_variant_textures.length = 0;
		selected_skin_name = null;

		const file_name = get_file_name_from_display(display_path);
		const data = core.view.mpq.getFile(display_path);
		if (!data)
			throw new Error('failed to load model file');

		const buffer = Buffer.from(data);
		const file = new BufferWrapper(buffer);

		const file_name_lower = file_name.toLowerCase();
		let is_m2 = false;

		if (file_name_lower.endsWith('.m2')) {
			core.view.legacyModelViewerActiveType = 'm2';
			active_renderer = new M2Renderer(file, render_group, true, core.view.config.modelViewerShowTextures);
			is_m2 = true;
		} else if (file_name_lower.endsWith('.wmo')) {
			core.view.legacyModelViewerActiveType = 'wmo';
			active_renderer = new WMORenderer(file, file_name, render_group, core.view.config.modelViewerShowTextures);
		} else {
			throw new Error('unknown model extension: ' + file_name);
		}

		await active_renderer.load();

		if (is_m2) {
			await load_m2_skins(file_name, display_path);
			load_m2_animations();
		}

		modelHelpers.fit_camera(render_group, camera, core.view.legacyModelViewerContext.controls);

		active_path = display_path;

		if (render_group.children.length === 0)
			core.setToast('info', util.format('the model %s doesn\'t have any 3D data associated with it.', file_name), null, 4000);
		else
			core.hideToast();
	} catch (e) {
		core.setToast('error', 'unable to preview model ' + display_path, { 'view log': () => log.openRuntimeLog() }, -1);
		log.write('failed to open model file: %s', e.message);
	}

	core.view.isBusy--;
};

const load_m2_skins = async (file_name, display_path) => {
	const skin_list = [];
	const base_name = path.basename(file_name, '.m2');
	const dir_name = path.dirname(file_name);

	// scan for alternative skin textures in same directory
	const blp_files = core.view.mpq.getFilesByExtension('.blp');
	const skin_textures = blp_files.filter(blp_path => {
		const blp_file_name = get_file_name_from_display(blp_path);
		const blp_dir = path.dirname(blp_file_name);
		const blp_base = path.basename(blp_file_name, '.blp');

		// check if in same directory and starts with model name
		return blp_dir === dir_name && blp_base.startsWith(base_name) && blp_base !== base_name;
	});

	// add base skin
	const base_textures = active_renderer.m2?.textures || [];
	if (base_textures.length > 0) {
		skin_list.push({ id: 'base', label: 'base' });
		active_skins.set('base', { textures: [] });
	}

	// add alternative skins
	for (const skin_texture of skin_textures) {
		const blp_file_name = get_file_name_from_display(skin_texture);
		const blp_base = path.basename(blp_file_name, '.blp');
		const clean_name = blp_base.replace(base_name, '').replace(/^_/, '');

		if (!active_skins.has(clean_name)) {
			skin_list.push({ id: clean_name, label: clean_name });
			active_skins.set(clean_name, { textures: [skin_texture] });
		}
	}

	core.view.legacyModelViewerSkins = skin_list;
	core.view.legacyModelViewerSkinsSelection = skin_list.slice(0, 1);
};

const load_m2_animations = () => {
	if (!active_renderer || !active_renderer.m2)
		return;

	const anim_list = [];
	const anim_source = active_renderer.skelLoader || active_renderer.m2;

	for (let i = 0; i < anim_source.animations.length; i++) {
		const animation = anim_source.animations[i];
		anim_list.push({
			id: `${Math.floor(animation.id)}.${animation.variationIndex}`,
			animationId: animation.id,
			m2Index: i,
			label: AnimMapper.get_anim_name(animation.id) + ' (' + Math.floor(animation.id) + '.' + animation.variationIndex + ')'
		});
	}

	const final_anim_list = [
		{ id: 'none', label: 'No Animation', m2Index: -1 },
		...anim_list
	];

	core.view.legacyModelViewerAnims = final_anim_list;
	core.view.legacyModelViewerAnimSelection = 'none';
};

const get_variant_textures = (display_path) => {
	if (display_path === active_path)
		return selected_variant_textures;

	return [];
};

const export_files = async (files) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportModelFormat;
	const manifest = { type: 'MODELS_LEGACY', succeeded: [], failed: [] };

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_path) {
			core.setToast('progress', 'saving preview, hold on...', null, -1, false);

			const canvas = document.getElementById('model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			if (format === 'PNG') {
				const file_name = get_file_name_from_display(active_path);
				const export_path = ExportHelper.getExportPath(file_name);
				let out_file = ExportHelper.replaceExtension(export_path, '.png');

				if (core.view.config.modelsExportPngIncrements)
					out_file = await ExportHelper.getIncrementalFilename(out_file);

				const out_dir = path.dirname(out_file);
				await buf.writeToFile(out_file);
				await export_paths?.writeLine('PNG:' + out_file);

				log.write('saved 3D preview screenshot to %s', out_file);
				core.setToast('success', util.format('successfully exported preview to %s', out_file), { 'view in explorer': () => nw.Shell.openItem(out_dir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

				log.write('copied 3D preview to clipboard (%s)', active_path);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'the selected export option only works for model previews. preview something first!', null, -1);
		}
	} else {
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (const file_entry of files) {
			if (helper.isCancelled())
				return;

			const display_path = file_entry;
			const file_name = get_file_name_from_display(display_path);
			const file_manifest = [];

			try {
				const data_raw = core.view.mpq.getFile(display_path);
				if (!data_raw)
					throw new Error('failed to load file from mpq');

				const buffer = Buffer.from(data_raw);
				const data = new BufferWrapper(buffer);

				let file_type;
				const file_name_lower = file_name.toLowerCase();

				if (file_name_lower.endsWith('.m2'))
					file_type = MODEL_TYPE_M2;
				else if (file_name_lower.endsWith('.wmo'))
					file_type = MODEL_TYPE_WMO;
				else
					throw new Error('unknown model file type');

				let export_path;
				if (file_type === MODEL_TYPE_M2 && selected_skin_name !== null && display_path === active_path && format !== 'RAW') {
					const base_file_name = path.basename(file_name, path.extname(file_name));
					const skinned_name = ExportHelper.replaceBaseName(file_name, base_file_name + '_' + selected_skin_name);
					export_path = ExportHelper.getExportPath(skinned_name);
				} else {
					export_path = ExportHelper.getExportPath(file_name);
				}

				switch (format) {
					case 'RAW': {
						await export_paths?.writeLine(export_path);

						let exporter;
						if (file_type === MODEL_TYPE_M2)
							exporter = new M2Exporter(data, get_variant_textures(display_path), -1);
						else if (file_type === MODEL_TYPE_WMO)
							exporter = new WMOExporter(data, file_name);

						await exporter.exportRaw(export_path, helper, file_manifest, true);
						if (file_type === MODEL_TYPE_WMO)
							WMOExporter.clearCache();
						break;
					}
					case 'OBJ':
					case 'GLTF':
					case 'GLB':
						export_path = ExportHelper.replaceExtension(export_path, export_extensions[format]);

						if (file_type === MODEL_TYPE_M2) {
							const exporter = new M2Exporter(data, get_variant_textures(display_path), -1);

							if (display_path === active_path)
								exporter.setGeosetMask(core.view.legacyModelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(export_path, core.view.config.modelsExportCollision, helper, file_manifest, true);
								await export_paths?.writeLine('M2_OBJ:' + export_path);
							} else if (format === 'GLTF' || format === 'GLB') {
								await exporter.exportAsGLTF(export_path, helper, format.toLowerCase(), true);
								await export_paths?.writeLine('M2_' + format + ':' + export_path);
							}

							if (helper.isCancelled())
								return;
						} else if (file_type === MODEL_TYPE_WMO) {
							const exporter = new WMOExporter(data, file_name);

							if (display_path === active_path) {
								exporter.setGroupMask(core.view.legacyModelViewerWMOGroups);
								exporter.setDoodadSetMask(core.view.legacyModelViewerWMOSets);
							}

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(export_path, helper, file_manifest, true);
								await export_paths?.writeLine('WMO_OBJ:' + export_path);
							} else if (format === 'GLTF' || format === 'GLB') {
								await exporter.exportAsGLTF(export_path, helper, format.toLowerCase(), true);
								await export_paths?.writeLine('WMO_' + format + ':' + export_path);
							}

							WMOExporter.clearCache();

							if (helper.isCancelled())
								return;
						} else {
							throw new Error('unexpected model format: ' + file_name);
						}

						break;

					default:
						throw new Error('unexpected model export format: ' + format);
				}

				helper.mark(file_name, true);
				manifest.succeeded.push({ files: file_manifest });
			} catch (e) {
				helper.mark(file_name, false, e.message, e.stack);
				manifest.failed.push({});
			}
		}

		helper.finish();
	}

	export_paths?.close();
};

core.events.once('screen-legacy-tab-models', async () => {
	const progress = core.createProgress(2);
	core.view.setScreen('loading');
	core.view.isBusy++;

	try {
		await progress.step('loading models...');
		const m2_files = core.view.mpq.getFilesByExtension('.m2');
		const wmo_files = core.view.mpq.getFilesByExtension('.wmo').filter(file => !/_[0-9]{3}\.wmo$/i.test(file));
		core.view.listfileLegacyModels = [...m2_files, ...wmo_files];

		await progress.step('initializing 3D preview...');
		const scene_data = modelHelpers.init_3d_scene(
			core.view.config.modelViewerShowBackground,
			core.view.config.modelViewerBackgroundColor,
			core.view.config.modelViewerShowGrid
		);

		camera = scene_data.camera;
		scene = scene_data.scene;
		grid = scene_data.grid;
		render_group.copy(scene_data.render_group);
		scene.add(render_group);

		core.view.legacyModelViewerContext = Object.seal({ camera, scene, controls: null });

		// set up watchers after scene initialization
		modelHelpers.setup_grid_watcher(scene, grid);
		modelHelpers.setup_background_watchers(scene);

		core.view.isBusy--;
		core.view.setScreen('legacy-tab-models');
	} catch (error) {
		core.view.isBusy--;
		core.view.setScreen('legacy-tab-models');
		log.write('failed to initialize legacy models tab: %o', error);
		core.setToast('error', 'failed to initialize models tab. check the log for details.');
	}
});

core.registerLoadFunc(async () => {
	core.view.$watch('legacyModelViewerSkinsSelection', async selection => {
		if (!active_renderer || active_skins.size === 0)
			return;

		const selected = selection[0];
		const display = active_skins.get(selected.id);
		selected_skin_name = selected.id;

		if (display && display.textures && display.textures.length > 0)
			selected_variant_textures = [...display.textures];
		else
			selected_variant_textures = [];

		if (active_renderer.applyReplaceableTextures)
			active_renderer.applyReplaceableTextures(display);
	});

	core.view.$watch('legacyModelViewerAnimSelection', async selected_animation_id => {
		if (!active_renderer || !active_renderer.playAnimation || core.view.legacyModelViewerAnims.length === 0)
			return;

		if (selected_animation_id !== null && selected_animation_id !== undefined) {
			if (selected_animation_id === 'none') {
				active_renderer?.stopAnimation?.();

				if (core.view.legacyModelViewerAutoAdjust)
					requestAnimationFrame(() => modelHelpers.fit_camera(render_group, camera, core.view.legacyModelViewerContext.controls));
				return;
			}

			const anim_info = core.view.legacyModelViewerAnims.find(anim => anim.id == selected_animation_id);
			if (anim_info && anim_info.m2Index !== undefined && anim_info.m2Index >= 0) {
				log.write('playing animation %s at M2 index %d', selected_animation_id, anim_info.m2Index);
				await active_renderer.playAnimation(anim_info.m2Index);

				if (core.view.legacyModelViewerAutoAdjust)
					requestAnimationFrame(() => modelHelpers.fit_camera(render_group, camera, core.view.legacyModelViewerContext.controls));
			}
		}
	});

	core.view.$watch('selectionLegacyModels', async selection => {
		if (!core.view.config.modelsAutoPreview)
			return;

		const first = selection[0];
		if (!core.view.isBusy && first && active_path !== first)
			preview_model(first);
	});

	core.events.on('click-preview-legacy-texture', async (node) => {
		await preview_texture_by_path(node.fileName, node.displayName);
	});

	core.events.on('click-export-legacy-model', async () => {
		const user_selection = core.view.selectionLegacyModels;
		if (user_selection.length === 0) {
			core.setToast('info', 'you didn\'t select any files to export; you should do that first.');
			return;
		}

		await export_files(user_selection);
	});

	core.events.on('toggle-legacy-uv-layer', (layer_name) => {
		modelHelpers.toggle_uv_layer(layer_name, active_renderer, {
			uv_layers: 'legacyModelViewerUVLayers',
			preview_width: 'legacyModelTexturePreviewWidth',
			preview_height: 'legacyModelTexturePreviewHeight',
			preview_uv_overlay: 'legacyModelTexturePreviewUVOverlay'
		});
	});

	core.events.on('click-export-legacy-ribbon-texture', async (node) => {
		await textureExporter.exportFiles([node.fileName], false, -1, true);
	});
});

module.exports = {
	getActiveRenderer: () => active_renderer
};
