const log = require('../log');
const util = require('util');
const path = require('path');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const constants = require('../constants');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const BLPFile = require('../casc/blp');
const InstallType = require('../install-type');
const listboxContext = require('../ui/listbox-context');

const DBModelFileData = require('../db/caches/DBModelFileData');
const DBItemDisplays = require('../db/caches/DBItemDisplays');
const DBCreatures = require('../db/caches/DBCreatures');

const M2RendererGL = require('../3D/renderers/M2RendererGL');
const M3RendererGL = require('../3D/renderers/M3RendererGL');
const M2Exporter = require('../3D/exporters/M2Exporter');
const M3Exporter = require('../3D/exporters/M3Exporter');

const WMORendererGL = require('../3D/renderers/WMORendererGL');
const WMOExporter = require('../3D/exporters/WMOExporter');

const textureRibbon = require('../ui/texture-ribbon');
const textureExporter = require('../ui/texture-exporter');
const uvDrawer = require('../ui/uv-drawer');
const AnimMapper = require('../3D/AnimMapper');

const MODEL_TYPE_M3 = Symbol('modelM3');
const MODEL_TYPE_M2 = Symbol('modelM2');
const MODEL_TYPE_WMO = Symbol('modelWMO');

const export_extensions = {
	'OBJ': '.obj',
	'STL': '.stl',
	'GLTF': '.gltf',
	'GLB': '.glb'
};

const active_skins = new Map();
let selected_variant_texture_ids = new Array();
let selected_skin_name = null;

let active_renderer;
let active_path;

const get_model_displays = (file_data_id) => {
	let displays = DBCreatures.getCreatureDisplaysByFileDataID(file_data_id);

	if (displays === undefined)
		displays = DBItemDisplays.getItemDisplaysByFileDataID(file_data_id);

	return displays ?? [];
};

const clear_texture_preview = (core) => {
	core.view.modelTexturePreviewURL = '';
	core.view.modelTexturePreviewUVOverlay = '';
	core.view.modelViewerUVLayers = [];
};

const initialize_uv_layers = (core) => {
	if (!active_renderer || !active_renderer.getUVLayers) {
		core.view.modelViewerUVLayers = [];
		return;
	}

	const uv_layer_data = active_renderer.getUVLayers();
	core.view.modelViewerUVLayers = [
		{ name: 'UV Off', data: null, active: true },
		...uv_layer_data.layers
	];
};

const toggle_uv_layer = (core, layer_name) => {
	const layer = core.view.modelViewerUVLayers.find(l => l.name === layer_name);
	if (!layer)
		return;

	core.view.modelViewerUVLayers.forEach(l => {
		l.active = (l === layer);
	});

	if (layer_name === 'UV Off' || !layer.data) {
		core.view.modelTexturePreviewUVOverlay = '';
	} else if (active_renderer && active_renderer.getUVLayers) {
		const uv_layer_data = active_renderer.getUVLayers();
		const overlay_data_url = uvDrawer.generateUVLayerDataURL(
			layer.data,
			core.view.modelTexturePreviewWidth,
			core.view.modelTexturePreviewHeight,
			uv_layer_data.indices
		);
		core.view.modelTexturePreviewUVOverlay = overlay_data_url;
	}
};

const preview_texture_by_id = async (core, file_data_id, name) => {
	const texture = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id);

	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const view = core.view;
		const file = await core.view.casc.getFile(file_data_id);

		const blp = new BLPFile(file);

		view.modelTexturePreviewURL = blp.getDataURL(view.config.exportChannelMask);
		view.modelTexturePreviewWidth = blp.width;
		view.modelTexturePreviewHeight = blp.height;
		view.modelTexturePreviewName = name;

		initialize_uv_layers(core);

		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const preview_model = async (core, file_name) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', file_name), null, -1, false);
	log.write('Previewing model %s', file_name);

	textureRibbon.reset();
	clear_texture_preview(core);

	core.view.modelViewerSkins = [];
	core.view.modelViewerSkinsSelection = [];
	core.view.modelViewerAnims = [];
	core.view.modelViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = null;
			active_path = null;
		}

		active_skins.clear();
		selected_variant_texture_ids.length = 0;
		selected_skin_name = null;

		const file_data_id = listfile.getByFilename(file_name);
		const file = await core.view.casc.getFile(file_data_id);
		let is_m2 = false;
		let is_m3 = false;

		const file_name_lower = file_name.toLowerCase();
		const gl_context = core.view.modelViewerContext?.gl_context;

		if (file_name_lower.endsWith('.m2')) {
			core.view.modelViewerActiveType = 'm2';
			active_renderer = new M2RendererGL(file, gl_context, true, core.view.config.modelViewerShowTextures);
			is_m2 = true;
		} else if (file_name_lower.endsWith('.m3')) {
			core.view.modelViewerActiveType = 'm3';
			active_renderer = new M3RendererGL(file, gl_context, true, core.view.config.modelViewerShowTextures);
			is_m3 = true;
		} else if (file_name_lower.endsWith('.wmo')) {
			core.view.modelViewerActiveType = 'wmo';
			active_renderer = new WMORendererGL(file, file_name, gl_context, core.view.config.modelViewerShowTextures);
		} else {
			throw new Error('Unknown model extension: %s', file_name);
		}

		await active_renderer.load();

		if (is_m2) {
			const displays = get_model_displays(file_data_id);

			const skin_list = [];
			let model_name = listfile.getByID(file_data_id);
			model_name = path.basename(model_name, 'm2');

			for (const display of displays) {
				if (display.textures.length === 0)
					continue;

				const texture = display.textures[0];

				let clean_skin_name = '';
				let skin_name = listfile.getByID(texture);
				if (skin_name !== undefined) {
					skin_name = path.basename(skin_name, '.blp');
					clean_skin_name = skin_name.replace(model_name, '').replace('_', '');
				} else {
					skin_name = 'unknown_' + texture;
				}

				if (clean_skin_name.length === 0)
					clean_skin_name = 'base';

				if (display.extraGeosets?.length > 0)
					skin_name += display.extraGeosets.join(',');

				clean_skin_name += ' (' + display.ID + ')';

				if (active_skins.has(skin_name))
					continue;

				skin_list.push({ id: skin_name, label: clean_skin_name });
				active_skins.set(skin_name, display);
			}

			core.view.modelViewerSkins = skin_list;
			core.view.modelViewerSkinsSelection = skin_list.slice(0, 1);

			if (file_name_lower.endsWith('.m2')) {
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

				core.view.modelViewerAnims = final_anim_list;
				core.view.modelViewerAnimSelection = 'none';
			}
		}

		active_path = file_name;

		// check for empty model
		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;

		if (!has_content) {
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', file_name), null, 4000);
		} else {
			core.hideToast();

			// fit camera to model if auto-adjust is enabled
			if (core.view.modelViewerAutoAdjust)
				requestAnimationFrame(() => core.view.modelViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', file_name, e.key), null, -1);
			log.write('Failed to decrypt model %s (%s)', file_name, e.key);
		} else {
			core.setToast('error', 'Unable to preview model ' + file_name, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const get_variant_texture_ids = (file_name) => {
	if (file_name === active_path) {
		return selected_variant_texture_ids;
	} else {
		const file_data_id = listfile.getByFilename(file_name);
		const displays = get_model_displays(file_data_id);

		return displays.find(e => e.textures.length > 0)?.textures ?? [];
	}
};

const export_files = async (core, files, is_local = false, export_id = -1) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportModelFormat;

	const manifest = { type: 'MODELS', exportID: export_id, succeeded: [], failed: [] };

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_path) {
			core.setToast('progress', 'Saving preview, hold on...', null, -1, false);

			const canvas = document.getElementById('model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			if (format === 'PNG') {
				const export_path = ExportHelper.getExportPath(active_path);
				let out_file = ExportHelper.replaceExtension(export_path, '.png');

				if (core.view.config.modelsExportPngIncrements)
					out_file = await ExportHelper.getIncrementalFilename(out_file);

				const out_dir = path.dirname(out_file);

				await buf.writeToFile(out_file);
				await export_paths?.writeLine('PNG:' + out_file);

				log.write('Saved 3D preview screenshot to %s', out_file);
				core.setToast('success', util.format('Successfully exported preview to %s', out_file), { 'View in Explorer': () => nw.Shell.openItem(out_dir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

				log.write('Copied 3D preview to clipboard (%s)', active_path);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}
	} else {
		const casc = core.view.casc;
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (const file_entry of files) {
			if (helper.isCancelled())
				return;

			let file_name;
			let file_data_id;

			if (typeof file_entry === 'number') {
				file_data_id = file_entry;
				file_name = listfile.getByID(file_data_id);
			} else {
				file_name = listfile.stripFileEntry(file_entry);
				file_data_id = listfile.getByFilename(file_name);
			}

			const file_manifest = [];

			try {
				let file_type;
				const data = await (is_local ? BufferWrapper.readFile(file_name) : casc.getFile(file_data_id));

				if (file_name === undefined) {
					const magic = data.readUInt32LE();
					data.seek(0);

					if (magic == constants.MAGIC.M3DT) {
						file_type = MODEL_TYPE_M3;
						file_name = listfile.formatUnknownFile(file_data_id, '.m3');
					} else if (magic === constants.MAGIC.MD20 || magic === constants.MAGIC.MD21) {
						file_type = MODEL_TYPE_M2;
						file_name = listfile.formatUnknownFile(file_data_id, '.m2');
					} else {
						file_type = MODEL_TYPE_WMO;
						file_name = listfile.formatUnknownFile(file_data_id, '.wmo');
					}
				} else {
					const file_name_lower = file_name.toLowerCase();
					if (file_name_lower.endsWith('.m3') === true)
						file_type = MODEL_TYPE_M3;
					else if (file_name_lower.endsWith('.m2') === true)
						file_type = MODEL_TYPE_M2;
					else if (file_name_lower.endsWith('.wmo') === true)
						file_type = MODEL_TYPE_WMO;
				}

				if (!file_type)
					throw new Error('Unknown model file type for %d', file_data_id);

				let export_path;
				let mark_file_name = file_name;
				if (is_local) {
					export_path = file_name;
				} else if (file_type === MODEL_TYPE_M2 && selected_skin_name !== null && file_name === active_path && format !== 'RAW') {
					const base_file_name = path.basename(file_name, path.extname(file_name));
					let skinned_name;

					if (selected_skin_name.startsWith(base_file_name))
						skinned_name = ExportHelper.replaceBaseName(file_name, selected_skin_name);
					else
						skinned_name = ExportHelper.replaceBaseName(file_name, base_file_name + '_' + selected_skin_name);

					export_path = ExportHelper.getExportPath(skinned_name);
					mark_file_name = skinned_name;
				} else {
					export_path = ExportHelper.getExportPath(file_name);
				}

				switch (format) {
					case 'RAW': {
						await export_paths?.writeLine(export_path);

						let exporter;
						if (file_type === MODEL_TYPE_M2)
							exporter = new M2Exporter(data, get_variant_texture_ids(file_name), file_data_id);
						else if (file_type === MODEL_TYPE_M3)
							exporter = new M3Exporter(data, get_variant_texture_ids(file_name), file_data_id);
						else if (file_type === MODEL_TYPE_WMO)
							exporter = new WMOExporter(data, file_data_id);

						await exporter.exportRaw(export_path, helper, file_manifest);
						if (file_type === MODEL_TYPE_WMO)
							WMOExporter.clearCache();
						break;
					}
					case 'OBJ':
					case 'STL':
					case 'GLTF':
					case 'GLB':
						export_path = ExportHelper.replaceExtension(export_path, export_extensions[format]);
						mark_file_name = ExportHelper.replaceExtension(mark_file_name, export_extensions[format]);

						if (file_type === MODEL_TYPE_M2) {
							const exporter = new M2Exporter(data, get_variant_texture_ids(file_name), file_data_id);

							if (file_name == active_path)
								exporter.setGeosetMask(core.view.modelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(export_path, core.view.config.modelsExportCollision, helper, file_manifest);
								await export_paths?.writeLine('M2_OBJ:' + export_path);
							} else if (format === 'STL') {
								await exporter.exportAsSTL(export_path, core.view.config.modelsExportCollision, helper, file_manifest);
								await export_paths?.writeLine('M2_STL:' + export_path);
							} else if (format === 'GLTF' || format === 'GLB') {
								await exporter.exportAsGLTF(export_path, helper, format.toLowerCase());
								await export_paths?.writeLine('M2_' + format + ':' + export_path);
							}

							if (helper.isCancelled())
								return;
						} else if (file_type === MODEL_TYPE_M3) {
							const exporter = new M3Exporter(data, get_variant_texture_ids(file_name), file_data_id);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(export_path, core.view.config.modelsExportCollision, helper, file_manifest);
								await export_paths?.writeLine('M3_OBJ:' + export_path);
							} else if (format === 'STL') {
								await exporter.exportAsSTL(export_path, core.view.config.modelsExportCollision, helper, file_manifest);
								await export_paths?.writeLine('M3_STL:' + export_path);
							} else if (format === 'GLTF' || format === 'GLB') {
								await exporter.exportAsGLTF(export_path, helper, format.toLowerCase());
								await export_paths?.writeLine('M3_' + format + ':' + export_path);
							}

							if (helper.isCancelled())
								return;
						} else if (file_type === MODEL_TYPE_WMO) {
							if (is_local)
								throw new Error('Converting local WMO objects is currently not supported.');

							const exporter = new WMOExporter(data, file_name);

							if (file_name === active_path) {
								exporter.setGroupMask(core.view.modelViewerWMOGroups);
								exporter.setDoodadSetMask(core.view.modelViewerWMOSets);
							}

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(export_path, helper, file_manifest);
								await export_paths?.writeLine('WMO_OBJ:' + export_path);
							} else if (format === 'STL') {
								await exporter.exportAsSTL(export_path, helper, file_manifest);
								await export_paths?.writeLine('WMO_STL:' + export_path);
							} else if (format === 'GLTF' || format === 'GLB') {
								await exporter.exportAsGLTF(export_path, helper, format.toLowerCase());
								await export_paths?.writeLine('WMO_' + format + ':' + export_path);
							}

							WMOExporter.clearCache();

							if (helper.isCancelled())
								return;
						} else {
							throw new Error('Unexpected model format: ' + file_name);
						}

						break;

					default:
						throw new Error('Unexpected model export format: ' + format);
				}

				helper.mark(mark_file_name, true);
				manifest.succeeded.push({ fileDataID: file_data_id, files: file_manifest });
			} catch (e) {
				helper.mark(mark_file_name, false, e.message, e.stack);
				manifest.failed.push({ fileDataID: file_data_id });
			}
		}

		helper.finish();
	}

	export_paths?.close();
};

module.exports = {
	register() {
		this.registerNavButton('Models', 'cube.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-models">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionModels" v-model:filter="$core.view.userInputFilterModels" :items="$core.view.listfileModels" :override="$core.view.overrideModelList" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="model" persistscrollkey="models" :quickfilters="$core.view.modelQuickFilters" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_listfile_format(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }} (listfile format)</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_file_data_ids(context.node.selection)">Copy file data ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterModels" placeholder="Filter models..."/>
			</div>
			<div class="preview-container">
				<component :is="$components.ResizeLayer" @resize="$core.view.onTextureRibbonResize" id="texture-ribbon" v-if="$core.view.config.modelViewerShowTextures && $core.view.textureRibbonStack.length > 0">
					<div id="texture-ribbon-prev" v-if="$core.view.textureRibbonPage > 0" @click.self="$core.view.textureRibbonPage--"></div>
					<div v-for="slot in $core.view.textureRibbonDisplay" :title="slot.displayName" :style="{ backgroundImage: 'url(' + slot.src + ')' }" class="slot" @click="$core.view.contextMenus.nodeTextureRibbon = slot"></div>
					<div id="texture-ribbon-next" v-if="$core.view.textureRibbonPage < $core.view.textureRibbonMaxPages - 1" @click.self="$core.view.textureRibbonPage++"></div>
					<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeTextureRibbon" v-slot:default="context" @close="$core.view.contextMenus.nodeTextureRibbon = null">
						<span @click.self="preview_texture(context.node.fileDataID, context.node.displayName)">Preview {{ context.node.displayName }}</span>
						<span @click.self="export_ribbon_texture(context.node.fileDataID, context.node.displayName)">Export {{ context.node.displayName }}</span>
						<span @click.self="$core.view.goToTexture(context.node.fileDataID)">Go to {{ context.node.displayName }}</span>
						<span @click.self="$core.view.copyToClipboard(context.node.fileDataID)">Copy file data ID to clipboard</span>
						<span @click.self="$core.view.copyToClipboard(context.node.displayName)">Copy texture name to clipboard</span>
						<span @click.self="$core.view.copyToClipboard(context.node.fileName)">Copy file path to clipboard</span>
						<span @click.self="$core.view.copyToClipboard($core.view.getExportPath(context.node.fileName))">Copy export path to clipboard</span>
					</component>
				</component>
				<div id="model-texture-preview" v-if="$core.view.modelTexturePreviewURL.length > 0" class="preview-background">
					<div id="model-texture-preview-toast" @click="$core.view.modelTexturePreviewURL = ''">Close Preview</div>
					<div class="image" :style="{ 'max-width': $core.view.modelTexturePreviewWidth + 'px', 'max-height': $core.view.modelTexturePreviewHeight + 'px' }">
						<div class="image" :style="{ 'background-image': 'url(' + $core.view.modelTexturePreviewURL + ')' }"></div>
						<div class="uv-overlay" v-if="$core.view.modelTexturePreviewUVOverlay" :style="{ 'background-image': 'url(' + $core.view.modelTexturePreviewUVOverlay + ')' }"></div>
					</div>
					<div id="uv-layer-buttons" v-if="$core.view.modelViewerUVLayers.length > 0">
						<button
							v-for="layer in $core.view.modelViewerUVLayers"
							:key="layer.name"
							:class="{ active: layer.active }"
							@click="toggle_uv_layer(layer.name)"
							class="uv-layer-button"
						>
							{{ layer.name }}
						</button>
					</div>
				</div>
				<div class="preview-background" id="model-preview">
					<input v-if="$core.view.config.modelViewerShowBackground" type="color" id="background-color-input" v-model="$core.view.config.modelViewerBackgroundColor" title="Click to change background color"/>
					<component :is="$components.ModelViewerGL" v-if="$core.view.modelViewerContext" :context="$core.view.modelViewerContext"></component>
					<div v-if="$core.view.modelViewerAnims && $core.view.modelViewerAnims.length > 0 && !$core.view.modelTexturePreviewURL" class="preview-dropdown-overlay">
						<select v-model="$core.view.modelViewerAnimSelection">
							<option v-for="animation in $core.view.modelViewerAnims" :key="animation.id" :value="animation.id">
								{{ animation.label }}
							</option>
						</select>
						<div v-if="$core.view.modelViewerAnimSelection !== 'none'" class="anim-controls">
							<button class="anim-btn anim-step-left" :class="{ disabled: !$core.view.modelViewerAnimPaused }" @click="step_animation(-1)" title="Previous frame"></button>
							<button class="anim-btn" :class="$core.view.modelViewerAnimPaused ? 'anim-play' : 'anim-pause'" @click="toggle_animation_pause()" :title="$core.view.modelViewerAnimPaused ? 'Play' : 'Pause'"></button>
							<button class="anim-btn anim-step-right" :class="{ disabled: !$core.view.modelViewerAnimPaused }" @click="step_animation(1)" title="Next frame"></button>
							<div class="anim-scrubber" @mousedown="start_scrub" @mouseup="end_scrub">
								<input type="range" min="0" :max="$core.view.modelViewerAnimFrameCount - 1" :value="$core.view.modelViewerAnimFrame" @input="seek_animation($event.target.value)" />
								<div class="anim-frame-display">{{ $core.view.modelViewerAnimFrame }}</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<component :is="$components.MenuButton" :options="$core.view.menuButtonModels" :default="$core.view.config.exportModelFormat" @change="$core.view.config.exportModelFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_model"></component>
			</div>
			<div id="model-sidebar" class="sidebar">
				<span class="header">Preview</span>
				<label class="ui-checkbox" title="Automatically preview a model when selecting it">
					<input type="checkbox" v-model="$core.view.config.modelsAutoPreview"/>
					<span>Auto Preview</span>
				</label>
				<label class="ui-checkbox" title="Automatically adjust camera when selecting a new model">
					<input type="checkbox" v-model="$core.view.modelViewerAutoAdjust"/>
					<span>Auto Camera</span>
				</label>
				<label class="ui-checkbox" title="Show a grid in the 3D viewport">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowGrid"/>
					<span>Show Grid</span>
				</label>
				<label class="ui-checkbox" title="Render the preview model as a wireframe">
					<input type="checkbox" v-model="$core.view.config.modelViewerWireframe"/>
					<span>Show Wireframe</span>
				</label>
				<label class="ui-checkbox" title="Show the model's bone structure">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowBones"/>
					<span>Show Bones</span>
				</label>
				<label class="ui-checkbox" title="Show model textures in the preview pane">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowTextures"/>
					<span>Show Textures</span>
				</label>
				<label class="ui-checkbox" title="Show a background color in the 3D viewport">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowBackground"/>
					<span>Show Background</span>
				</label>
				<span class="header">Export</span>
				<label class="ui-checkbox" title="Include textures when exporting models">
					<input type="checkbox" v-model="$core.view.config.modelsExportTextures"/>
					<span>Textures</span>
				</label>
				<label v-if="$core.view.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
					<input type="checkbox" v-model="$core.view.config.modelsExportAlpha"/>
					<span>Texture Alpha</span>
				</label>
				<label v-if="$core.view.config.exportModelFormat === 'GLTF' && $core.view.modelViewerActiveType === 'm2'" class="ui-checkbox" title="Include animations in export">
					<input type="checkbox" v-model="$core.view.config.modelsExportAnimations"/>
					<span>Export animations</span>
				</label>
				<template v-if="$core.view.config.exportModelFormat === 'RAW'">
					<label class="ui-checkbox" title="Export raw .skin files with M2 exports">
						<input type="checkbox" v-model="$core.view.config.modelsExportSkin"/>
						<span>M2 .skin Files</span>
					</label>
					<label class="ui-checkbox" title="Export raw .skel files with M2 exports">
						<input type="checkbox" v-model="$core.view.config.modelsExportSkel"/>
						<span>M2 .skel Files</span>
					</label>
					<label class="ui-checkbox" title="Export raw .bone files with M2 exports">
						<input type="checkbox" v-model="$core.view.config.modelsExportBone"/>
						<span>M2 .bone Files</span>
					</label>
					<label class="ui-checkbox" title="Export raw .anim files with M2 exports">
						<input type="checkbox" v-model="$core.view.config.modelsExportAnim"/>
						<span>M2 .anim files</span>
					</label>
					<label class="ui-checkbox" title="Export WMO group files">
						<input type="checkbox" v-model="$core.view.config.modelsExportWMOGroups"/>
						<span>WMO Groups</span>
					</label>
				</template>
				<template v-if="$core.view.config.exportModelFormat === 'OBJ' && $core.view.modelViewerActiveType === 'wmo'">
					<label class="ui-checkbox" title="Export each WMO group as a separate OBJ file">
						<input type="checkbox" v-model="$core.view.config.modelsExportSplitWMOGroups"/>
						<span>Split WMO Groups</span>
					</label>
				</template>
				<template v-if="$core.view.modelViewerActiveType === 'm2'">
					<span class="header">Geosets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.modelViewerGeosets"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllGeosets(true, $core.view.modelViewerGeosets)">Enable All</a> / <a @click="$core.view.setAllGeosets(false, $core.view.modelViewerGeosets)">Disable All</a>
					</div>
					<template v-if="$core.view.config.modelsExportTextures">
						<span class="header">Skins</span>
						<component :is="$components.Listboxb" :items="$core.view.modelViewerSkins" v-model:selection="$core.view.modelViewerSkinsSelection" :single="true"></component>
					</template>
				</template>
				<template v-if="$core.view.modelViewerActiveType === 'wmo'">
					<span class="header">WMO Groups</span>
					<component :is="$components.Checkboxlist" :items="$core.view.modelViewerWMOGroups"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllWMOGroups(true)">Enable All</a> / <a @click="$core.view.setAllWMOGroups(false)">Disable All</a>
					</div>
					<span class="header">Doodad Sets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.modelViewerWMOSets"></component>
				</template>
			</div>
		</div>
	`,

	methods: {
		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		copy_file_paths(selection) {
			listboxContext.copy_file_paths(selection);
		},

		copy_listfile_format(selection) {
			listboxContext.copy_listfile_format(selection);
		},

		copy_file_data_ids(selection) {
			listboxContext.copy_file_data_ids(selection);
		},

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

		async preview_texture(file_data_id, display_name) {
			await preview_texture_by_id(this.$core, file_data_id, display_name);
		},

		async export_ribbon_texture(file_data_id, display_name) {
			await textureExporter.exportSingleTexture(file_data_id);
		},

		toggle_uv_layer(layer_name) {
			toggle_uv_layer(this.$core, layer_name);
		},

		async export_model() {
			const user_selection = this.$core.view.selectionModels;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			await export_files(this.$core, user_selection, false);
		},

		toggle_animation_pause() {
			const renderer = active_renderer;
			if (!renderer)
				return;

			const paused = !this.$core.view.modelViewerAnimPaused;
			this.$core.view.modelViewerAnimPaused = paused;
			renderer.set_animation_paused(paused);
		},

		step_animation(delta) {
			if (!this.$core.view.modelViewerAnimPaused)
				return;

			const renderer = active_renderer;
			if (!renderer)
				return;

			renderer.step_animation_frame(delta);
			this.$core.view.modelViewerAnimFrame = renderer.get_animation_frame();
		},

		seek_animation(frame) {
			const renderer = active_renderer;
			if (!renderer)
				return;

			renderer.set_animation_frame(parseInt(frame));
			this.$core.view.modelViewerAnimFrame = parseInt(frame);
		},

		start_scrub() {
			this._was_paused_before_scrub = this.$core.view.modelViewerAnimPaused;
			if (!this._was_paused_before_scrub) {
				this.$core.view.modelViewerAnimPaused = true;
				active_renderer?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			if (!this._was_paused_before_scrub) {
				this.$core.view.modelViewerAnimPaused = false;
				active_renderer?.set_animation_paused?.(false);
			}
		}
	},

	async mounted() {
		// register drop handler
		this.$core.registerDropHandler({
			ext: ['.m2'],
			prompt: count => util.format('Export %d models as %s', count, this.$core.view.config.exportModelFormat),
			process: files => export_files(this.$core, files, true)
		});

		let step_count = 2;
		if (this.$core.view.config.enableUnknownFiles) step_count++;
		if (this.$core.view.config.enableM2Skins) step_count += 2;

		this.$core.showLoadingScreen(step_count);

		try {
			await this.$core.progressLoadingScreen('Loading model file data...');
			await DBModelFileData.initializeModelFileData();

			if (this.$core.view.config.enableUnknownFiles) {
				await this.$core.progressLoadingScreen('Loading unknown models...');
				await listfile.loadUnknownModels();
			}

			if (this.$core.view.config.enableM2Skins) {
				await this.$core.progressLoadingScreen('Loading item displays...');
				await DBItemDisplays.initializeItemDisplays();

				await this.$core.progressLoadingScreen('Loading creature data...');
				await DBCreatures.initializeCreatureData();
			}

			await this.$core.progressLoadingScreen('Initializing 3D preview...');

			// initialize model viewer context if not already present (gl_context populated by ModelViewerGL on mount)
			if (!this.$core.view.modelViewerContext)
				this.$core.view.modelViewerContext = Object.seal({ getActiveRenderer: () => active_renderer, gl_context: null, fitCamera: null });

			this.$core.hideLoadingScreen();

		} catch (error) {
			this.$core.hideLoadingScreen();
			log.write('Failed to initialize models tab: %o', error);
			this.$core.setToast('error', 'Failed to initialize models tab. Check the log for details.');
		}

		this.$core.view.$watch('modelViewerSkinsSelection', async selection => {
			if (!active_renderer || active_skins.size === 0)
				return;

			const selected = selection[0];
			const display = active_skins.get(selected.id);
			selected_skin_name = selected.id;

			let curr_geosets = this.$core.view.modelViewerGeosets;

			if (display.extraGeosets !== undefined) {
				for (const geoset of curr_geosets) {
					if (geoset.id > 0 && geoset.id < 900)
						geoset.checked = false;
				}

				for (const extra_geoset of display.extraGeosets) {
					for (const geoset of curr_geosets) {
						if (geoset.id === extra_geoset)
							geoset.checked = true;
					}
				}
			} else {
				for (const geoset of curr_geosets) {
					const id = geoset.id.toString();
					geoset.checked = (id.endsWith('0') || id.endsWith('01'));
				}
			}

			if (display.textures.length > 0)
				selected_variant_texture_ids = [...display.textures];

			active_renderer.applyReplaceableTextures(display);
		});

		this.$core.view.$watch('modelViewerAnimSelection', async selected_animation_id => {
			if (!active_renderer || !active_renderer.playAnimation || this.$core.view.modelViewerAnims.length === 0)
				return;

			// reset animation state
			this.$core.view.modelViewerAnimPaused = false;
			this.$core.view.modelViewerAnimFrame = 0;
			this.$core.view.modelViewerAnimFrameCount = 0;

			if (selected_animation_id !== null && selected_animation_id !== undefined) {
				if (selected_animation_id === 'none') {
					active_renderer?.stopAnimation?.();

					if (this.$core.view.modelViewerAutoAdjust)
						requestAnimationFrame(() => this.$core.view.modelViewerContext?.fitCamera?.());
					return;
				}

				const anim_info = this.$core.view.modelViewerAnims.find(anim => anim.id == selected_animation_id);
				if (anim_info && anim_info.m2Index !== undefined && anim_info.m2Index >= 0) {
					log.write(`Playing animation ${selected_animation_id} at M2 index ${anim_info.m2Index}`);
					await active_renderer.playAnimation(anim_info.m2Index);

					// set frame count after animation is loaded
					this.$core.view.modelViewerAnimFrameCount = active_renderer.get_animation_frame_count();

					if (this.$core.view.modelViewerAutoAdjust)
						requestAnimationFrame(() => this.$core.view.modelViewerContext?.fitCamera?.());
				}
			}
		});

		this.$core.view.$watch('selectionModels', async selection => {
			if (!this.$core.view.config.modelsAutoPreview)
				return;

			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && active_path !== first)
				preview_model(this.$core, first);
		});

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			toggle_uv_layer(this.$core, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
