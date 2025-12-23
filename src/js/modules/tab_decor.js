const log = require('../log');
const util = require('util');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const InstallType = require('../install-type');
const listboxContext = require('../ui/listbox-context');

const DBDecor = require('../db/caches/DBDecor');
const DBModelFileData = require('../db/caches/DBModelFileData');

const textureRibbon = require('../ui/texture-ribbon');
const textureExporter = require('../ui/texture-exporter');
const modelViewerUtils = require('../ui/model-viewer-utils');

let active_renderer;
let active_file_data_id;
let active_decor_item;

const get_view_state = (core) => ({
	get texturePreviewURL() { return core.view.decorTexturePreviewURL; },
	set texturePreviewURL(v) { core.view.decorTexturePreviewURL = v; },
	get texturePreviewUVOverlay() { return core.view.decorTexturePreviewUVOverlay; },
	set texturePreviewUVOverlay(v) { core.view.decorTexturePreviewUVOverlay = v; },
	get texturePreviewWidth() { return core.view.decorTexturePreviewWidth; },
	set texturePreviewWidth(v) { core.view.decorTexturePreviewWidth = v; },
	get texturePreviewHeight() { return core.view.decorTexturePreviewHeight; },
	set texturePreviewHeight(v) { core.view.decorTexturePreviewHeight = v; },
	get texturePreviewName() { return core.view.decorTexturePreviewName; },
	set texturePreviewName(v) { core.view.decorTexturePreviewName = v; },
	get uvLayers() { return core.view.decorViewerUVLayers; },
	set uvLayers(v) { core.view.decorViewerUVLayers = v; },
	get anims() { return core.view.decorViewerAnims; },
	set anims(v) { core.view.decorViewerAnims = v; },
	get animSelection() { return core.view.decorViewerAnimSelection; },
	set animSelection(v) { core.view.decorViewerAnimSelection = v; },
	get animPaused() { return core.view.decorViewerAnimPaused; },
	set animPaused(v) { core.view.decorViewerAnimPaused = v; },
	get animFrame() { return core.view.decorViewerAnimFrame; },
	set animFrame(v) { core.view.decorViewerAnimFrame = v; },
	get animFrameCount() { return core.view.decorViewerAnimFrameCount; },
	set animFrameCount(v) { core.view.decorViewerAnimFrameCount = v; },
	get autoAdjust() { return core.view.decorViewerAutoAdjust; },
	set autoAdjust(v) { core.view.decorViewerAutoAdjust = v; }
});

const preview_decor = async (core, decor_item) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', decor_item.name), null, -1, false);
	log.write('Previewing decor %s (FileDataID: %d)', decor_item.name, decor_item.modelFileDataID);

	const state = get_view_state(core);
	textureRibbon.reset();
	modelViewerUtils.clear_texture_preview(state);

	core.view.decorViewerAnims = [];
	core.view.decorViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = null;
			active_file_data_id = null;
			active_decor_item = null;
		}

		const file_data_id = decor_item.modelFileDataID;
		const file = await core.view.casc.getFile(file_data_id);
		const gl_context = core.view.decorViewerContext?.gl_context;

		const model_type = modelViewerUtils.detect_model_type(file);
		const file_name = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id, modelViewerUtils.get_model_extension(model_type));

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			core.view.decorViewerActiveType = 'm2';
		else if (model_type === modelViewerUtils.MODEL_TYPE_WMO)
			core.view.decorViewerActiveType = 'wmo';
		else
			core.view.decorViewerActiveType = 'm3';

		active_renderer = modelViewerUtils.create_renderer(file, model_type, gl_context, core.view.config.modelViewerShowTextures, file_name);

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			active_renderer.geosetKey = 'decorViewerGeosets';
		else if (model_type === modelViewerUtils.MODEL_TYPE_WMO) {
			active_renderer.wmoGroupKey = 'decorViewerWMOGroups';
			active_renderer.wmoSetKey = 'decorViewerWMOSets';
		}

		await active_renderer.load();

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			core.view.decorViewerAnims = modelViewerUtils.extract_animations(active_renderer);

		core.view.decorViewerAnimSelection = 'none';

		active_file_data_id = file_data_id;
		active_decor_item = decor_item;

		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;

		if (!has_content) {
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', decor_item.name), null, 4000);
		} else {
			core.hideToast();

			if (core.view.decorViewerAutoAdjust)
				requestAnimationFrame(() => core.view.decorViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', decor_item.name, e.key), null, -1);
			log.write('Failed to decrypt model %s (%s)', decor_item.name, e.key);
		} else {
			core.setToast('error', 'Unable to preview model ' + decor_item.name, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const export_files = async (core, entries, export_id = -1) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportDecorFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_file_data_id) {
			const canvas = document.getElementById('decor-preview').querySelector('canvas');
			const export_name = ExportHelper.sanitizeFilename(active_decor_item?.name ?? 'decor_' + active_file_data_id);
			await modelViewerUtils.export_preview(core, format, canvas, export_name, 'decor');
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}

		export_paths?.close();
		return;
	}

	const casc = core.view.casc;
	const helper = new ExportHelper(entries.length, 'decor');
	helper.start();

	for (const entry of entries) {
		if (helper.isCancelled())
			break;

		const decor_item = typeof entry === 'object' ? entry : DBDecor.getDecorItemByID(entry);
		if (!decor_item)
			continue;

		const file_manifest = [];
		const file_data_id = decor_item.modelFileDataID;
		const decor_name = ExportHelper.sanitizeFilename(decor_item.name);

		try {
			const data = await casc.getFile(file_data_id);
			const model_type = modelViewerUtils.detect_model_type(data);
			const file_ext = modelViewerUtils.get_model_extension(model_type);
			const file_name = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id, file_ext);
			const export_path = ExportHelper.getExportPath('decor/' + decor_name + file_ext);

			const is_active = file_data_id === active_file_data_id;

			const mark_name = await modelViewerUtils.export_model({
				core,
				data,
				file_data_id,
				file_name,
				format,
				export_path,
				helper,
				file_manifest,
				geoset_mask: is_active ? core.view.decorViewerGeosets : null,
				wmo_group_mask: is_active ? core.view.decorViewerWMOGroups : null,
				wmo_set_mask: is_active ? core.view.decorViewerWMOSets : null,
				export_paths
			});

			helper.mark(mark_name, true);
		} catch (e) {
			helper.mark(decor_name, false, e.message, e.stack);
		}
	}

	helper.finish();
	export_paths?.close();
};

module.exports = {
	register() {
		this.registerNavButton('Decor', 'house.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-decor">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionDecor" v-model:filter="$core.view.userInputFilterDecor" :items="$core.view.listfileDecor" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="item" persistscrollkey="decor" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_decor_names(context.node.selection)">Copy name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_file_data_ids(context.node.selection)">Copy file data ID{{ context.node.count > 1 ? 's' : '' }}</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterDecor" placeholder="Filter decor..."/>
			</div>
			<div class="preview-container">
				<component :is="$components.ResizeLayer" @resize="$core.view.onTextureRibbonResize" id="texture-ribbon" v-if="$core.view.config.modelViewerShowTextures && $core.view.textureRibbonStack.length > 0">
					<div id="texture-ribbon-prev" v-if="$core.view.textureRibbonPage > 0" @click.self="$core.view.textureRibbonPage--"></div>
					<div v-for="slot in $core.view.textureRibbonDisplay" :title="slot.displayName" :style="{ backgroundImage: 'url(' + slot.src + ')' }" class="slot" @click="$core.view.contextMenus.nodeTextureRibbon = slot"></div>
					<div id="texture-ribbon-next" v-if="$core.view.textureRibbonPage < $core.view.textureRibbonMaxPages - 1" @click.self="$core.view.textureRibbonPage++"></div>
					<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeTextureRibbon" v-slot:default="context" @close="$core.view.contextMenus.nodeTextureRibbon = null">
						<span @click.self="preview_texture(context.node.fileDataID, context.node.displayName)">Preview {{ context.node.displayName }}</span>
						<span @click.self="export_ribbon_texture(context.node.fileDataID, context.node.displayName)">Export {{ context.node.displayName }}</span>
						<span @click.self="$core.view.copyToClipboard(context.node.fileDataID)">Copy file data ID to clipboard</span>
						<span @click.self="$core.view.copyToClipboard(context.node.displayName)">Copy texture name to clipboard</span>
					</component>
				</component>
				<div id="decor-texture-preview" v-if="$core.view.decorTexturePreviewURL.length > 0" class="preview-background">
					<div id="decor-texture-preview-toast" @click="$core.view.decorTexturePreviewURL = ''">Close Preview</div>
					<div class="image" :style="{ 'max-width': $core.view.decorTexturePreviewWidth + 'px', 'max-height': $core.view.decorTexturePreviewHeight + 'px' }">
						<div class="image" :style="{ 'background-image': 'url(' + $core.view.decorTexturePreviewURL + ')' }"></div>
						<div class="uv-overlay" v-if="$core.view.decorTexturePreviewUVOverlay" :style="{ 'background-image': 'url(' + $core.view.decorTexturePreviewUVOverlay + ')' }"></div>
					</div>
					<div id="uv-layer-buttons" v-if="$core.view.decorViewerUVLayers.length > 0">
						<button
							v-for="layer in $core.view.decorViewerUVLayers"
							:key="layer.name"
							:class="{ active: layer.active }"
							@click="toggle_uv_layer(layer.name)"
							class="uv-layer-button"
						>
							{{ layer.name }}
						</button>
					</div>
				</div>
				<div class="preview-background" id="decor-preview">
					<input v-if="$core.view.config.modelViewerShowBackground" type="color" id="background-color-input" v-model="$core.view.config.modelViewerBackgroundColor" title="Click to change background color"/>
					<component :is="$components.ModelViewerGL" v-if="$core.view.decorViewerContext" :context="$core.view.decorViewerContext"></component>
					<div v-if="$core.view.decorViewerAnims && $core.view.decorViewerAnims.length > 0 && !$core.view.decorTexturePreviewURL" class="preview-dropdown-overlay">
						<select v-model="$core.view.decorViewerAnimSelection">
							<option v-for="animation in $core.view.decorViewerAnims" :key="animation.id" :value="animation.id">
								{{ animation.label }}
							</option>
						</select>
						<div v-if="$core.view.decorViewerAnimSelection !== 'none'" class="anim-controls">
							<button class="anim-btn anim-step-left" :class="{ disabled: !$core.view.decorViewerAnimPaused }" @click="step_animation(-1)" title="Previous frame"></button>
							<button class="anim-btn" :class="$core.view.decorViewerAnimPaused ? 'anim-play' : 'anim-pause'" @click="toggle_animation_pause()" :title="$core.view.decorViewerAnimPaused ? 'Play' : 'Pause'"></button>
							<button class="anim-btn anim-step-right" :class="{ disabled: !$core.view.decorViewerAnimPaused }" @click="step_animation(1)" title="Next frame"></button>
							<div class="anim-scrubber" @mousedown="start_scrub" @mouseup="end_scrub">
								<input type="range" min="0" :max="$core.view.decorViewerAnimFrameCount - 1" :value="$core.view.decorViewerAnimFrame" @input="seek_animation($event.target.value)" />
								<div class="anim-frame-display">{{ $core.view.decorViewerAnimFrame }}</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<component :is="$components.MenuButton" :options="$core.view.menuButtonDecor" :default="$core.view.config.exportDecorFormat" @change="$core.view.config.exportDecorFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_decor"></component>
			</div>
			<div id="decor-sidebar" class="sidebar">
				<span class="header">Preview</span>
				<label class="ui-checkbox" title="Automatically preview a decor item when selecting it">
					<input type="checkbox" v-model="$core.view.config.decorAutoPreview"/>
					<span>Auto Preview</span>
				</label>
				<label class="ui-checkbox" title="Automatically adjust camera when selecting a new item">
					<input type="checkbox" v-model="$core.view.decorViewerAutoAdjust"/>
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
				<template v-if="$core.view.decorViewerActiveType === 'm2'">
					<span class="header">Geosets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.decorViewerGeosets"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllDecorGeosets(true)">Enable All</a> / <a @click="$core.view.setAllDecorGeosets(false)">Disable All</a>
					</div>
				</template>
				<template v-if="$core.view.decorViewerActiveType === 'wmo'">
					<span class="header">WMO Groups</span>
					<component :is="$components.Checkboxlist" :items="$core.view.decorViewerWMOGroups"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllDecorWMOGroups(true)">Enable All</a> / <a @click="$core.view.setAllDecorWMOGroups(false)">Disable All</a>
					</div>
					<span class="header">Doodad Sets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.decorViewerWMOSets"></component>
				</template>
			</div>
		</div>
	`,

	methods: {
		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		copy_decor_names(selection) {
			const names = selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/^(.+)\s+\[(\d+)\]$/);
					return match ? match[1] : entry;
				}
				return entry.name || entry;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_file_data_ids(selection) {
			const ids = selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					return match ? match[1] : '';
				}
				return entry.modelFileDataID?.toString() || '';
			}).filter(id => id);
			nw.Clipboard.get().set(ids.join('\n'), 'text');
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

		async export_decor() {
			const user_selection = this.$core.view.selectionDecor;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any items to export; you should do that first.');
				return;
			}

			const decor_items = user_selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					if (match)
						return DBDecor.getDecorItemByID(parseInt(match[1]));
				}
				return entry;
			}).filter(item => item);

			await export_files(this.$core, decor_items);
		},

		...modelViewerUtils.create_animation_methods(
			() => active_renderer,
			() => get_view_state(this.$core)
		)
	},

	async mounted() {
		this.$core.showLoadingScreen(2);

		try {
			await this.$core.progressLoadingScreen('Loading model file data...');
			await DBModelFileData.initializeModelFileData();

			await this.$core.progressLoadingScreen('Loading house decor data...');
			await DBDecor.initializeDecorData();

			const decor_items = DBDecor.getAllDecorItems();
			const listfile_entries = [];

			for (const [id, item] of decor_items)
				listfile_entries.push(`${item.name} [${id}]`);

			listfile_entries.sort((a, b) => {
				const name_a = a.replace(/\s+\[\d+\]$/, '').toLowerCase();
				const name_b = b.replace(/\s+\[\d+\]$/, '').toLowerCase();
				return name_a.localeCompare(name_b);
			});

			this.$core.view.listfileDecor = listfile_entries;

			if (!this.$core.view.decorViewerContext)
				this.$core.view.decorViewerContext = Object.seal({ getActiveRenderer: () => active_renderer, gl_context: null, fitCamera: null });

			this.$core.hideLoadingScreen();
		} catch (error) {
			this.$core.hideLoadingScreen();
			log.write('Failed to initialize decor tab: %o', error);
			this.$core.setToast('error', 'Failed to initialize decor tab. Check the log for details.');
		}

		const state = get_view_state(this.$core);

		this.$core.view.$watch('decorViewerAnimSelection', async selected_animation_id => {
			if (this.$core.view.decorViewerAnims.length === 0)
				return;

			await modelViewerUtils.handle_animation_change(
				active_renderer,
				state,
				selected_animation_id,
				() => this.$core.view.decorViewerContext?.fitCamera?.()
			);
		});

		this.$core.view.$watch('selectionDecor', async selection => {
			if (!this.$core.view.config.decorAutoPreview)
				return;

			const first = selection[0];
			if (!first || this.$core.view.isBusy)
				return;

			let decor_id;
			if (typeof first === 'string') {
				const match = first.match(/\[(\d+)\]$/);
				if (match)
					decor_id = parseInt(match[1]);
			}

			if (!decor_id)
				return;

			const decor_item = DBDecor.getDecorItemByID(decor_id);
			if (decor_item && decor_item.modelFileDataID !== active_file_data_id)
				preview_decor(this.$core, decor_item);
		});

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			const state = get_view_state(this.$core);
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
