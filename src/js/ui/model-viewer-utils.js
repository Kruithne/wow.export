/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import log from '../log.js';
import * as platform from '../platform.js';
import BufferWrapper from '../buffer.js';
import { exporter as ExportHelper, listfile } from '../../views/main/rpc.js';
import constants from '../constants.js';
import BLPFile from '../casc/blp.js';

import M2RendererGL from '../3D/renderers/M2RendererGL.js';
import M3RendererGL from '../3D/renderers/M3RendererGL.js';
import M2Exporter from '../3D/exporters/M2Exporter.js';
import M3Exporter from '../3D/exporters/M3Exporter.js';

import WMORendererGL from '../3D/renderers/WMORendererGL.js';
import WMOExporter from '../3D/exporters/WMOExporter.js';

import textureRibbon from './texture-ribbon.js';
import * as uvDrawer from './uv-drawer.js';
import AnimMapper from '../3D/AnimMapper.js';

const MODEL_TYPE_M2 = Symbol('modelM2');
const MODEL_TYPE_M3 = Symbol('modelM3');
const MODEL_TYPE_WMO = Symbol('modelWMO');

const EXPORT_EXTENSIONS = {
	'OBJ': '.obj',
	'STL': '.stl',
	'GLTF': '.gltf',
	'GLB': '.glb'
};

/**
 * Detect model type from file data.
 * @param {BufferWrapper} data
 * @returns {Symbol}
 */
const detect_model_type = (data) => {
	const magic = data.readUInt32LE();
	data.seek(0);

	if (magic === constants.MAGIC.MD20 || magic === constants.MAGIC.MD21)
		return MODEL_TYPE_M2;

	if (magic === constants.MAGIC.M3DT)
		return MODEL_TYPE_M3;

	return MODEL_TYPE_WMO;
};

/**
 * Detect model type from file name.
 * @param {string} file_name
 * @returns {Symbol|null}
 */
const detect_model_type_by_name = (file_name) => {
	const lower = file_name.toLowerCase();

	if (lower.endsWith('.m2'))
		return MODEL_TYPE_M2;

	if (lower.endsWith('.m3'))
		return MODEL_TYPE_M3;

	if (lower.endsWith('.wmo'))
		return MODEL_TYPE_WMO;

	return null;
};

/**
 * Get file extension for model type.
 * @param {Symbol} model_type
 * @returns {string}
 */
const get_model_extension = (model_type) => {
	if (model_type === MODEL_TYPE_M2)
		return '.m2';

	if (model_type === MODEL_TYPE_M3)
		return '.m3';

	return '.wmo';
};

/**
 * Clear texture preview state.
 * @param {object} state - View state object with texture preview properties
 */
const clear_texture_preview = (state) => {
	state.texturePreviewURL = '';
	state.texturePreviewUVOverlay = '';
	state.uvLayers = [];
};

/**
 * Initialize UV layers from active renderer.
 * @param {object} state - View state object
 * @param {object} renderer - Active renderer instance
 */
const initialize_uv_layers = (state, renderer) => {
	if (!renderer || !renderer.getUVLayers) {
		state.uvLayers = [];
		return;
	}

	const uv_layer_data = renderer.getUVLayers();
	state.uvLayers = [
		{ name: 'UV Off', data: null, active: true },
		...uv_layer_data.layers
	];
};

/**
 * Toggle UV layer visibility.
 * @param {object} state - View state object
 * @param {object} renderer - Active renderer instance
 * @param {string} layer_name - Name of layer to toggle
 */
const toggle_uv_layer = (state, renderer, layer_name) => {
	const layer = state.uvLayers.find(l => l.name === layer_name);
	if (!layer)
		return;

	state.uvLayers.forEach(l => {
		l.active = (l === layer);
	});

	if (layer_name === 'UV Off' || !layer.data) {
		state.texturePreviewUVOverlay = '';
	} else if (renderer && renderer.getUVLayers) {
		const uv_layer_data = renderer.getUVLayers();
		const overlay_data_url = uvDrawer.generateUVLayerDataURL(
			layer.data,
			state.texturePreviewWidth,
			state.texturePreviewHeight,
			uv_layer_data.indices
		);
		state.texturePreviewUVOverlay = overlay_data_url;
	}
};

/**
 * Preview a texture by file data ID.
 * @param {object} core - Core instance
 * @param {object} state - View state object
 * @param {object} renderer - Active renderer instance
 * @param {number} file_data_id - Texture file data ID
 * @param {string} name - Display name for the texture
 */
const preview_texture_by_id = async (core, state, renderer, file_data_id, name) => {
	const texture = (await listfile.getByID(file_data_id)) ?? listfile.formatUnknownFile(file_data_id);

	using _lock = core.create_busy_lock();
	core.setToast('progress', `Loading ${texture}, please wait...`, null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const file = await core.view.casc.getFile(file_data_id);
		const blp = new BLPFile(file);

		state.texturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
		state.texturePreviewWidth = blp.width;
		state.texturePreviewHeight = blp.height;
		state.texturePreviewName = name;

		initialize_uv_layers(state, renderer);

		core.hideToast();
	} catch (e) {
		if (e.name === 'EncryptionError') {
			core.setToast('error', `The texture ${texture} is encrypted with an unknown key (${e.key}).`, null, -1);
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

/**
 * Create appropriate renderer for model data.
 * @param {BufferWrapper} data - Model file data
 * @param {Symbol} model_type - Model type symbol
 * @param {WebGLRenderingContext} gl_context - GL context
 * @param {boolean} show_textures - Whether to show textures
 * @param {string} file_name - File name (required for WMO)
 * @returns {object} Renderer instance
 */
const create_renderer = (data, model_type, gl_context, show_textures, file_name = null) => {
	if (model_type === MODEL_TYPE_M2)
		return new M2RendererGL(data, gl_context, true, show_textures);

	if (model_type === MODEL_TYPE_M3)
		return new M3RendererGL(data, gl_context, true, show_textures);

	return new WMORendererGL(data, file_name, gl_context, show_textures);
};

/**
 * Extract animation list from renderer.
 * @param {object} renderer - M2 renderer instance
 * @returns {Array} Animation list
 */
const extract_animations = (renderer) => {
	const anim_list = [];
	const anim_source = renderer.skelLoader || renderer.m2;

	for (let i = 0; i < anim_source.animations.length; i++) {
		const animation = anim_source.animations[i];
		anim_list.push({
			id: `${Math.floor(animation.id)}.${animation.variationIndex}`,
			animationId: animation.id,
			m2Index: i,
			label: AnimMapper.get_anim_name(animation.id) + ' (' + Math.floor(animation.id) + '.' + animation.variationIndex + ')'
		});
	}

	return [
		{ id: 'none', label: 'No Animation', m2Index: -1 },
		...anim_list
	];
};

/**
 * Handle animation selection change.
 * @param {object} renderer - Active renderer
 * @param {object} state - View state with animation properties
 * @param {string} selected_animation_id - Selected animation ID
 */
const handle_animation_change = async (renderer, state, selected_animation_id) => {
	if (!renderer || !renderer.playAnimation)
		return;

	// reset animation state
	state.animPaused = false;
	state.animFrame = 0;
	state.animFrameCount = 0;

	if (selected_animation_id === null || selected_animation_id === undefined)
		return;

	if (selected_animation_id === 'none') {
		renderer?.stopAnimation?.();
		return;
	}

	const anim_info = state.anims.find(anim => anim.id == selected_animation_id);
	if (anim_info && anim_info.m2Index !== undefined && anim_info.m2Index >= 0) {
		log.write(`Playing animation ${selected_animation_id} at M2 index ${anim_info.m2Index}`);
		await renderer.playAnimation(anim_info.m2Index);

		state.animFrameCount = renderer.get_animation_frame_count();
	}
};

/**
 * Export 3D preview as PNG or to clipboard.
 * @param {object} core - Core instance
 * @param {string} format - 'PNG' or 'CLIPBOARD'
 * @param {HTMLCanvasElement} canvas - Preview canvas
 * @param {string} export_name - Base name for export
 * @param {string} export_subdir - Subdirectory for export
 * @returns {boolean} Success
 */
const export_preview = async (core, format, canvas, export_name, export_subdir = '') => {
	core.setToast('progress', 'Saving preview, hold on...', null, -1, false);

	const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

	if (format === 'PNG') {
		const export_paths = core.openLastExportStream();
		const base_path = export_subdir ? export_subdir + '/' + export_name : export_name;
		const export_path = ExportHelper.getExportPath(base_path);
		let out_file = ExportHelper.replaceExtension(export_path, '.png');

		if (core.view.config.modelsExportPngIncrements)
			out_file = await ExportHelper.getIncrementalFilename(out_file);

		const out_dir = out_file.substring(0, out_file.lastIndexOf('/'));

		await buf.writeToFile(out_file);
		await export_paths?.writeLine('PNG:' + out_file);
		export_paths?.close();

		log.write('Saved 3D preview screenshot to %s', out_file);
		core.setToast('success', `Successfully exported preview to ${out_file}`, { 'View in Explorer': () => platform.open_path(out_dir) }, -1);
	} else if (format === 'CLIPBOARD') {
		platform.clipboard_write_image(buf.toBase64());

		log.write('Copied 3D preview to clipboard (%s)', export_name);
		core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
	}

	return true;
};

/**
 * Export a model file.
 * @param {object} options - Export options
 * @param {object} options.core - Core instance
 * @param {BufferWrapper} options.data - Model file data
 * @param {number} options.file_data_id - File data ID
 * @param {string} options.file_name - File name
 * @param {string} options.format - Export format
 * @param {string} options.export_path - Export path
 * @param {object} options.helper - Export helper
 * @param {Array} options.file_manifest - File manifest array
 * @param {Array} options.variant_textures - Variant texture IDs
 * @param {Array} options.geoset_mask - Geoset mask (for active model)
 * @param {Array} options.wmo_group_mask - WMO group mask (for active model)
 * @param {Array} options.wmo_set_mask - WMO doodad set mask (for active model)
 * @param {object} options.export_paths - Export paths stream
 */
const export_model = async (options) => {
	const {
		core,
		data,
		file_data_id,
		file_name,
		format,
		export_path,
		helper,
		file_manifest,
		variant_textures = [],
		geoset_mask = null,
		wmo_group_mask = null,
		wmo_set_mask = null,
		export_paths = null
	} = options;

	const model_type = detect_model_type_by_name(file_name) ?? detect_model_type(data);
	let final_export_path = export_path;
	let mark_file_name = ExportHelper.getRelativeExport(export_path);

	switch (format) {
		case 'RAW': {
			await export_paths?.writeLine(final_export_path);

			let exporter;
			if (model_type === MODEL_TYPE_M2)
				exporter = new M2Exporter(data, variant_textures, file_data_id);
			else if (model_type === MODEL_TYPE_M3)
				exporter = new M3Exporter(data, variant_textures, file_data_id);
			else if (model_type === MODEL_TYPE_WMO)
				exporter = new WMOExporter(data, file_data_id);

			await exporter.exportRaw(final_export_path, helper, file_manifest);

			if (model_type === MODEL_TYPE_WMO)
				WMOExporter.clearCache();

			break;
		}

		case 'OBJ':
		case 'STL':
		case 'GLTF':
		case 'GLB':
			final_export_path = ExportHelper.replaceExtension(final_export_path, EXPORT_EXTENSIONS[format]);
			mark_file_name = ExportHelper.getRelativeExport(final_export_path);

			if (model_type === MODEL_TYPE_M2) {
				const exporter = new M2Exporter(data, variant_textures, file_data_id);

				if (geoset_mask)
					exporter.setGeosetMask(geoset_mask);

				if (format === 'OBJ') {
					await exporter.exportAsOBJ(final_export_path, core.view.config.modelsExportCollision, helper, file_manifest);
					await export_paths?.writeLine('M2_OBJ:' + final_export_path);
				} else if (format === 'STL') {
					await exporter.exportAsSTL(final_export_path, core.view.config.modelsExportCollision, helper, file_manifest);
					await export_paths?.writeLine('M2_STL:' + final_export_path);
				} else if (format === 'GLTF' || format === 'GLB') {
					await exporter.exportAsGLTF(final_export_path, helper, format.toLowerCase());
					await export_paths?.writeLine('M2_' + format + ':' + final_export_path);
				}
			} else if (model_type === MODEL_TYPE_M3) {
				const exporter = new M3Exporter(data, variant_textures, file_data_id);

				if (format === 'OBJ') {
					await exporter.exportAsOBJ(final_export_path, core.view.config.modelsExportCollision, helper, file_manifest);
					await export_paths?.writeLine('M3_OBJ:' + final_export_path);
				} else if (format === 'STL') {
					await exporter.exportAsSTL(final_export_path, core.view.config.modelsExportCollision, helper, file_manifest);
					await export_paths?.writeLine('M3_STL:' + final_export_path);
				} else if (format === 'GLTF' || format === 'GLB') {
					await exporter.exportAsGLTF(final_export_path, helper, format.toLowerCase());
					await export_paths?.writeLine('M3_' + format + ':' + final_export_path);
				}
			} else if (model_type === MODEL_TYPE_WMO) {
				const exporter = new WMOExporter(data, file_name);

				if (wmo_group_mask)
					exporter.setGroupMask(wmo_group_mask);

				if (wmo_set_mask)
					exporter.setDoodadSetMask(wmo_set_mask);

				if (format === 'OBJ') {
					await exporter.exportAsOBJ(final_export_path, helper, file_manifest, core.view.config.modelsExportSplitWMOGroups);
					await export_paths?.writeLine('WMO_OBJ:' + final_export_path);
				} else if (format === 'STL') {
					await exporter.exportAsSTL(final_export_path, helper, file_manifest);
					await export_paths?.writeLine('WMO_STL:' + final_export_path);
				} else if (format === 'GLTF' || format === 'GLB') {
					await exporter.exportAsGLTF(final_export_path, helper, format.toLowerCase());
					await export_paths?.writeLine('WMO_' + format + ':' + final_export_path);
				}

				WMOExporter.clearCache();
			}

			break;

		default:
			throw new Error('Unexpected model export format: ' + format);
	}

	return mark_file_name;
};

/**
 * Create animation control methods for a tab.
 * @param {function} get_renderer - Function that returns active renderer
 * @param {function} get_state - Function that returns animation state object
 * @returns {object} Methods object
 */
const create_animation_methods = (get_renderer, get_state) => {
	return {
		toggle_animation_pause() {
			const renderer = get_renderer();
			const state = get_state();
			if (!renderer)
				return;

			const paused = !state.animPaused;
			state.animPaused = paused;
			renderer.set_animation_paused(paused);
		},

		step_animation(delta) {
			const state = get_state();
			if (!state.animPaused)
				return;

			const renderer = get_renderer();
			if (!renderer)
				return;

			renderer.step_animation_frame(delta);
			state.animFrame = renderer.get_animation_frame();
		},

		seek_animation(frame) {
			const renderer = get_renderer();
			const state = get_state();
			if (!renderer)
				return;

			renderer.set_animation_frame(parseInt(frame));
			state.animFrame = parseInt(frame);
		},

		start_scrub() {
			const state = get_state();
			this._was_paused_before_scrub = state.animPaused;
			if (!this._was_paused_before_scrub) {
				state.animPaused = true;
				get_renderer()?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			const state = get_state();
			if (!this._was_paused_before_scrub) {
				state.animPaused = false;
				get_renderer()?.set_animation_paused?.(false);
			}
		}
	};
};

/**
 * Create a view state proxy for a model viewer tab.
 * @param {object} core - Core instance
 * @param {string} prefix - Property prefix (e.g. 'model', 'decor', 'creature')
 * @returns {object} Proxy mapping generic names to prefixed core.view properties
 */
const create_view_state = (core, prefix) => ({
	get texturePreviewURL() { return core.view[prefix + 'TexturePreviewURL']; },
	set texturePreviewURL(v) { core.view[prefix + 'TexturePreviewURL'] = v; },
	get texturePreviewUVOverlay() { return core.view[prefix + 'TexturePreviewUVOverlay']; },
	set texturePreviewUVOverlay(v) { core.view[prefix + 'TexturePreviewUVOverlay'] = v; },
	get texturePreviewWidth() { return core.view[prefix + 'TexturePreviewWidth']; },
	set texturePreviewWidth(v) { core.view[prefix + 'TexturePreviewWidth'] = v; },
	get texturePreviewHeight() { return core.view[prefix + 'TexturePreviewHeight']; },
	set texturePreviewHeight(v) { core.view[prefix + 'TexturePreviewHeight'] = v; },
	get texturePreviewName() { return core.view[prefix + 'TexturePreviewName']; },
	set texturePreviewName(v) { core.view[prefix + 'TexturePreviewName'] = v; },
	get uvLayers() { return core.view[prefix + 'ViewerUVLayers']; },
	set uvLayers(v) { core.view[prefix + 'ViewerUVLayers'] = v; },
	get anims() { return core.view[prefix + 'ViewerAnims']; },
	set anims(v) { core.view[prefix + 'ViewerAnims'] = v; },
	get animSelection() { return core.view[prefix + 'ViewerAnimSelection']; },
	set animSelection(v) { core.view[prefix + 'ViewerAnimSelection'] = v; },
	get animPaused() { return core.view[prefix + 'ViewerAnimPaused']; },
	set animPaused(v) { core.view[prefix + 'ViewerAnimPaused'] = v; },
	get animFrame() { return core.view[prefix + 'ViewerAnimFrame']; },
	set animFrame(v) { core.view[prefix + 'ViewerAnimFrame'] = v; },
	get animFrameCount() { return core.view[prefix + 'ViewerAnimFrameCount']; },
	set animFrameCount(v) { core.view[prefix + 'ViewerAnimFrameCount'] = v; },
	get autoAdjust() { return core.view[prefix + 'ViewerAutoAdjust']; },
	set autoAdjust(v) { core.view[prefix + 'ViewerAutoAdjust'] = v; }
});

export {
	MODEL_TYPE_M2,
	MODEL_TYPE_M3,
	MODEL_TYPE_WMO,
	EXPORT_EXTENSIONS,
	detect_model_type,
	detect_model_type_by_name,
	get_model_extension,
	clear_texture_preview,
	initialize_uv_layers,
	toggle_uv_layer,
	preview_texture_by_id,
	create_renderer,
	extract_animations,
	handle_animation_change,
	export_preview,
	export_model,
	create_animation_methods,
	create_view_state
};
