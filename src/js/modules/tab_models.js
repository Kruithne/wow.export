import log from '../log.js';
import InstallType from '../install-type.js';
import { listfile, exporter, dbc } from '../../views/main/rpc.js';
import { DBCreatures, DBItemDisplays, DBModelFileData } from '../db-proxy.js';
import listboxContext from '../ui/listbox-context.js';

import textureRibbon from '../ui/texture-ribbon.js';
import textureExporter from '../ui/texture-exporter.js';
import modelViewerUtils from '../ui/model-viewer-utils.js';

const ExportHelper = exporter;

const active_skins = new Map();
let selected_variant_texture_ids = new Array();
let selected_skin_name = null;

let active_renderer;
let active_path;

const get_view_state = (core) => ({
	get texturePreviewURL() { return core.view.modelTexturePreviewURL; },
	set texturePreviewURL(v) { core.view.modelTexturePreviewURL = v; },
	get texturePreviewUVOverlay() { return core.view.modelTexturePreviewUVOverlay; },
	set texturePreviewUVOverlay(v) { core.view.modelTexturePreviewUVOverlay = v; },
	get texturePreviewWidth() { return core.view.modelTexturePreviewWidth; },
	set texturePreviewWidth(v) { core.view.modelTexturePreviewWidth = v; },
	get texturePreviewHeight() { return core.view.modelTexturePreviewHeight; },
	set texturePreviewHeight(v) { core.view.modelTexturePreviewHeight = v; },
	get texturePreviewName() { return core.view.modelTexturePreviewName; },
	set texturePreviewName(v) { core.view.modelTexturePreviewName = v; },
	get uvLayers() { return core.view.modelViewerUVLayers; },
	set uvLayers(v) { core.view.modelViewerUVLayers = v; },
	get anims() { return core.view.modelViewerAnims; },
	set anims(v) { core.view.modelViewerAnims = v; },
	get animSelection() { return core.view.modelViewerAnimSelection; },
	set animSelection(v) { core.view.modelViewerAnimSelection = v; },
	get animPaused() { return core.view.modelViewerAnimPaused; },
	set animPaused(v) { core.view.modelViewerAnimPaused = v; },
	get animFrame() { return core.view.modelViewerAnimFrame; },
	set animFrame(v) { core.view.modelViewerAnimFrame = v; },
	get animFrameCount() { return core.view.modelViewerAnimFrameCount; },
	set animFrameCount(v) { core.view.modelViewerAnimFrameCount = v; },
	get autoAdjust() { return core.view.modelViewerAutoAdjust; },
	set autoAdjust(v) { core.view.modelViewerAutoAdjust = v; }
});

const get_model_displays = async (file_data_id) => {
	let displays = await DBCreatures.getCreatureDisplaysByFileDataID(file_data_id);

	if (displays == null)
		displays = await DBItemDisplays.getItemDisplaysByFileDataID(file_data_id);

	return displays ?? [];
};

const preview_model = async (core, file_name) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', `Loading ${file_name}, please wait...`, null, -1, false);
	log.write('Previewing model %s', file_name);

	const state = get_view_state(core);
	textureRibbon.reset();
	modelViewerUtils.clear_texture_preview(state);

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

		const file_data_id = await listfile.getByFilename(file_name);
		const file = await core.view.casc.getFile(file_data_id);
		const gl_context = core.view.modelViewerContext?.gl_context;

		const model_type = modelViewerUtils.detect_model_type_by_name(file_name) ?? modelViewerUtils.detect_model_type(file);

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			core.view.modelViewerActiveType = 'm2';
		else if (model_type === modelViewerUtils.MODEL_TYPE_M3)
			core.view.modelViewerActiveType = 'm3';
		else
			core.view.modelViewerActiveType = 'wmo';

		active_renderer = modelViewerUtils.create_renderer(file, model_type, gl_context, core.view.config.modelViewerShowTextures, file_name);
		await active_renderer.load();

		if (model_type === modelViewerUtils.MODEL_TYPE_M2) {
			const displays = await get_model_displays(file_data_id);

			const skin_list = [];
			let model_name = await listfile.getByID(file_data_id);
			model_name = model_name.substring(model_name.lastIndexOf('/') + 1).replace(/\.?m2$/i, '');

			for (const display of displays) {
				if (display.textures.length === 0)
					continue;

				const texture = display.textures[0];

				let clean_skin_name = '';
				let skin_name = await listfile.getByID(texture);
				if (skin_name !== undefined) {
					skin_name = skin_name.substring(skin_name.lastIndexOf('/') + 1).replace(/\.blp$/i, '');
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

			core.view.modelViewerAnims = modelViewerUtils.extract_animations(active_renderer);
			core.view.modelViewerAnimSelection = 'none';
		}

		active_path = file_name;

		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;

		if (!has_content) {
			core.setToast('info', `The model ${file_name} doesn't have any 3D data associated with it.`, null, 4000);
		} else {
			core.hideToast();

			if (core.view.modelViewerAutoAdjust)
				requestAnimationFrame(() => core.view.modelViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e.name === 'EncryptionError') {
			core.setToast('error', `The model ${file_name} is encrypted with an unknown key (${e.key}).`, null, -1);
			log.write('Failed to decrypt model %s (%s)', file_name, e.key);
		} else {
			core.setToast('error', 'Unable to preview model ' + file_name, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const get_variant_texture_ids = async (file_name) => {
	if (file_name === active_path)
		return selected_variant_texture_ids;

	const file_data_id = await listfile.getByFilename(file_name);
	const displays = await get_model_displays(file_data_id);

	return displays.find(e => e.textures.length > 0)?.textures ?? [];
};

const export_files = async (core, files, is_local = false, export_id = -1) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportModelFormat;

	const manifest = { type: 'MODELS', exportID: export_id, succeeded: [], failed: [] };

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_path) {
			const canvas = document.getElementById('model-preview').querySelector('canvas');
			await modelViewerUtils.export_preview(core, format, canvas, active_path);
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}

		export_paths?.close();
		return;
	}

	const casc = core.view.casc;
	const helper = new ExportHelper(files.length, 'model');
	helper.start();

	for (const file_entry of files) {
		if (helper.isCancelled())
			break;

		let file_name;
		let file_data_id;

		if (typeof file_entry === 'number') {
			file_data_id = file_entry;
			file_name = await listfile.getByID(file_data_id);
		} else {
			file_name = listfile.stripFileEntry(file_entry);
			file_data_id = await listfile.getByFilename(file_name);
		}

		const file_manifest = [];

		try {
			const data = await (is_local ? (await import('../buffer.js')).default.readFile(file_name) : casc.getFile(file_data_id));

			if (file_name === undefined) {
				const model_type = modelViewerUtils.detect_model_type(data);
				file_name = listfile.formatUnknownFile(file_data_id, modelViewerUtils.get_model_extension(model_type));
			}

			let export_path;
			let mark_file_name = file_name;

			const is_active = file_name === active_path;
			const model_type = modelViewerUtils.detect_model_type_by_name(file_name) ?? modelViewerUtils.detect_model_type(data);

			if (is_local) {
				export_path = file_name;
			} else if (model_type === modelViewerUtils.MODEL_TYPE_M2 && selected_skin_name !== null && is_active && format !== 'RAW') {
				const fn_name = file_name.substring(file_name.lastIndexOf('/') + 1);
				const fn_dot = fn_name.lastIndexOf('.');
				const base_file_name = fn_dot !== -1 ? fn_name.substring(0, fn_dot) : fn_name;
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

			const mark_name = await modelViewerUtils.export_model({
				core,
				data,
				file_data_id,
				file_name,
				format,
				export_path,
				helper,
				file_manifest,
				variant_textures: await get_variant_texture_ids(file_name),
				geoset_mask: is_active ? core.view.modelViewerGeosets : null,
				wmo_group_mask: is_active ? core.view.modelViewerWMOGroups : null,
				wmo_set_mask: is_active ? core.view.modelViewerWMOSets : null,
				export_paths
			});

			helper.mark(mark_name, true);
			manifest.succeeded.push({ fileDataID: file_data_id, files: file_manifest });
		} catch (e) {
			helper.mark(file_name, false, e.message, e.stack);
			manifest.failed.push({ fileDataID: file_data_id });
		}
	}

	helper.finish();
	export_paths?.close();
};

export default {
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
			const state = get_view_state(this.$core);
			await modelViewerUtils.preview_texture_by_id(this.$core, state, active_renderer, file_data_id, display_name);
		},

		async export_ribbon_texture(file_data_id, display_name) {
			await textureExporter.exportSingleTexture(file_data_id);
		},

		toggle_uv_layer(layer_name) {
			const state = get_view_state(this.$core);
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
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
			if (!active_renderer)
				return;

			const state = get_view_state(this.$core);
			const paused = !state.animPaused;
			state.animPaused = paused;
			active_renderer.set_animation_paused(paused);
		},

		step_animation(delta) {
			const state = get_view_state(this.$core);
			if (!state.animPaused || !active_renderer)
				return;

			active_renderer.step_animation_frame(delta);
			state.animFrame = active_renderer.get_animation_frame();
		},

		seek_animation(frame) {
			const state = get_view_state(this.$core);
			if (!active_renderer)
				return;

			active_renderer.set_animation_frame(parseInt(frame));
			state.animFrame = parseInt(frame);
		},

		start_scrub() {
			const state = get_view_state(this.$core);
			this._was_paused_before_scrub = state.animPaused;
			if (!this._was_paused_before_scrub) {
				state.animPaused = true;
				active_renderer?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			const state = get_view_state(this.$core);
			if (!this._was_paused_before_scrub) {
				state.animPaused = false;
				active_renderer?.set_animation_paused?.(false);
			}
		},

		async initialize() {
			let step_count = 2;
			if (this.$core.view.config.enableUnknownFiles) step_count++;
			if (this.$core.view.config.enableM2Skins) step_count += 2;

			this.$core.showLoadingScreen(step_count);

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

			if (!this.$core.view.modelViewerContext)
				this.$core.view.modelViewerContext = Object.seal({ getActiveRenderer: () => active_renderer, gl_context: null, fitCamera: null });

			this.$core.hideLoadingScreen();
		}
	},

	async mounted() {
		this.$core.registerDropHandler({
			ext: ['.m2'],
			prompt: count => `Export ${count} models as ${this.$core.view.config.exportModelFormat}`,
			process: files => export_files(this.$core, files, true)
		});

		await this.initialize();

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

		const state = get_view_state(this.$core);

		this.$core.view.$watch('modelViewerAnimSelection', async selected_animation_id => {
			if (this.$core.view.modelViewerAnims.length === 0)
				return;

			await modelViewerUtils.handle_animation_change(
				active_renderer,
				state,
				selected_animation_id
			);
		});

		this.$core.view.$watch('selectionModels', async selection => {
			if (!this._tab_initialized)
				return;

			if (!this.$core.view.config.modelsAutoPreview)
				return;

			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && active_path !== first)
				preview_model(this.$core, first);
		});

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			const state = get_view_state(this.$core);
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
