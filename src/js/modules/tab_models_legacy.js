/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const log = require('../log');
const util = require('util');
const path = require('path');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const InstallType = require('../install-type');
const listboxContext = require('../ui/listbox-context');

const M2LegacyRendererGL = require('../3D/renderers/M2LegacyRendererGL');
const WMOLegacyRendererGL = require('../3D/renderers/WMOLegacyRendererGL');
const MDXRendererGL = require('../3D/renderers/MDXRendererGL');

const textureRibbon = require('../ui/texture-ribbon');
const AnimMapper = require('../3D/AnimMapper');

const MAGIC_MD20 = 0x3032444D; // 'MD20'
const MAGIC_MDLX = 0x584C444D; // 'MDLX'

const MODEL_TYPE_MDX = Symbol('modelMDX');
const MODEL_TYPE_M2 = Symbol('modelM2');
const MODEL_TYPE_WMO = Symbol('modelWMO');

let active_renderer;
let active_path;

const clear_texture_preview = (core) => {
	core.view.legacyModelTexturePreviewURL = '';
};

const preview_model = async (core, file_name) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', file_name), null, -1, false);
	log.write('Previewing legacy model %s', file_name);

	textureRibbon.reset();
	clear_texture_preview(core);

	core.view.legacyModelViewerAnims = [];
	core.view.legacyModelViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = null;
			active_path = null;
		}

		const mpq = core.view.mpq;
		const file_data = mpq.getFile(file_name);

		if (!file_data)
			throw new Error('File not found in MPQ: ' + file_name);

		const data = new BufferWrapper(Buffer.from(file_data));
		const magic = data.readUInt32LE();
		data.seek(0);

		const file_name_lower = file_name.toLowerCase();
		const gl_context = core.view.legacyModelViewerContext?.gl_context;

		if (magic === MAGIC_MDLX) {
			// alpha mdx format
			core.view.legacyModelViewerActiveType = 'mdx';
			active_renderer = new MDXRendererGL(data, gl_context, true, core.view.config.modelViewerShowTextures);
		} else if (magic === MAGIC_MD20) {
			// legacy m2 format (no MD21 wrapper)
			core.view.legacyModelViewerActiveType = 'm2';
			active_renderer = new M2LegacyRendererGL(data, gl_context, true, core.view.config.modelViewerShowTextures);
		} else if (file_name_lower.endsWith('.wmo')) {
			core.view.legacyModelViewerActiveType = 'wmo';
			active_renderer = new WMOLegacyRendererGL(data, file_name, gl_context, core.view.config.modelViewerShowTextures);
		} else {
			throw new Error('Unknown legacy model format: 0x' + magic.toString(16));
		}

		await active_renderer.load();

		// setup animations for m2/mdx
		if (core.view.legacyModelViewerActiveType === 'm2' || core.view.legacyModelViewerActiveType === 'mdx') {
			const anim_list = [];
			const model = core.view.legacyModelViewerActiveType === 'm2' ? active_renderer.m2 : active_renderer.mdx;

			if (model.animations) {
				for (let i = 0; i < model.animations.length; i++) {
					const animation = model.animations[i];

					if (core.view.legacyModelViewerActiveType === 'm2') {
						anim_list.push({
							id: `${animation.id}.${animation.variationIndex}`,
							animationId: animation.id,
							m2Index: i,
							label: AnimMapper.get_anim_name(animation.id) + ' (' + animation.id + '.' + animation.variationIndex + ')'
						});
					} else {
						// mdx uses sequence names
						anim_list.push({
							id: i.toString(),
							m2Index: i,
							label: animation.name || ('Animation ' + i)
						});
					}
				}
			}

			const final_anim_list = [
				{ id: 'none', label: 'No Animation', m2Index: -1 },
				...anim_list
			];

			core.view.legacyModelViewerAnims = final_anim_list;
			core.view.legacyModelViewerAnimSelection = 'none';
		}

		active_path = file_name;

		// check for empty model
		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;

		if (!has_content) {
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', file_name), null, 4000);
		} else {
			core.hideToast();

			// fit camera to model if auto-adjust is enabled
			if (core.view.legacyModelViewerAutoAdjust)
				requestAnimationFrame(() => core.view.legacyModelViewerContext?.fitCamera?.());
		}
	} catch (e) {
		core.setToast('error', 'Unable to preview model ' + file_name, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load legacy model: %s', e.message);
		log.write(e.stack);
	}
};

const export_files = async (core, files, export_id = -1) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportLegacyModelFormat;

	const manifest = { type: 'LEGACY_MODELS', exportID: export_id, succeeded: [], failed: [] };

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_path) {
			core.setToast('progress', 'Saving preview, hold on...', null, -1, false);

			const canvas = document.getElementById('legacy-model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			if (format === 'PNG') {
				const export_path = ExportHelper.getExportPath(active_path);
				let out_file = ExportHelper.replaceExtension(export_path, '.png');

				if (core.view.config.modelsExportPngIncrements)
					out_file = await ExportHelper.getIncrementalFilename(out_file);

				const out_dir = path.dirname(out_file);

				await buf.writeToFile(out_file);
				await export_paths?.writeLine('PNG:' + out_file);

				log.write('Saved legacy 3D preview screenshot to %s', out_file);
				core.setToast('success', util.format('Successfully exported preview to %s', out_file), { 'View in Explorer': () => nw.Shell.openItem(out_dir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

				log.write('Copied legacy 3D preview to clipboard (%s)', active_path);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}
	} else if (format === 'RAW') {
		const mpq = core.view.mpq;
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (const file_entry of files) {
			if (helper.isCancelled())
				return;

			let file_name = file_entry;
			const file_manifest = [];

			try {
				const file_data = mpq.getFile(file_name);
				if (!file_data)
					throw new Error('File not found in MPQ');

				const export_path = ExportHelper.getExportPath(file_name);
				await export_paths?.writeLine(export_path);

				// extract raw file
				const buf = new BufferWrapper(Buffer.from(file_data));
				await buf.writeToFile(export_path);
				file_manifest.push(export_path);

				helper.mark(file_name, true);
				manifest.succeeded.push({ file: file_name, files: file_manifest });
			} catch (e) {
				helper.mark(file_name, false, e.message, e.stack);
				manifest.failed.push({ file: file_name });
			}
		}

		helper.finish();
	} else {
		core.setToast('error', 'Export format not yet implemented for legacy models: ' + format, null, -1);
	}

	export_paths?.close();
};

module.exports = {
	register() {
		this.registerNavButton('Models', 'cube.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="tab-models-legacy">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionLegacyModels" v-model:filter="$core.view.userInputFilterLegacyModels" :items="$core.view.listfileLegacyModels" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="model" persistscrollkey="legacy-models" :quickfilters="$core.view.legacyModelQuickFilters" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterLegacyModels" placeholder="Filter models..."/>
			</div>
			<div class="preview-container">
				<component :is="$components.ResizeLayer" @resize="$core.view.onTextureRibbonResize" id="texture-ribbon" v-if="$core.view.config.modelViewerShowTextures && $core.view.textureRibbonStack.length > 0">
					<div id="texture-ribbon-prev" v-if="$core.view.textureRibbonPage > 0" @click.self="$core.view.textureRibbonPage--"></div>
					<div v-for="slot in $core.view.textureRibbonDisplay" :title="slot.displayName" :style="{ backgroundImage: 'url(' + slot.src + ')' }" class="slot"></div>
					<div id="texture-ribbon-next" v-if="$core.view.textureRibbonPage < $core.view.textureRibbonMaxPages - 1" @click.self="$core.view.textureRibbonPage++"></div>
				</component>
				<div class="preview-background" id="legacy-model-preview">
					<input v-if="$core.view.config.modelViewerShowBackground" type="color" id="background-color-input" v-model="$core.view.config.modelViewerBackgroundColor" title="Click to change background color"/>
					<component :is="$components.ModelViewerGL" v-if="$core.view.legacyModelViewerContext" :context="$core.view.legacyModelViewerContext"></component>
					<div v-if="$core.view.legacyModelViewerAnims && $core.view.legacyModelViewerAnims.length > 0" class="preview-dropdown-overlay">
						<select v-model="$core.view.legacyModelViewerAnimSelection">
							<option v-for="animation in $core.view.legacyModelViewerAnims" :key="animation.id" :value="animation.id">
								{{ animation.label }}
							</option>
						</select>
						<div v-if="$core.view.legacyModelViewerAnimSelection !== 'none'" class="anim-controls">
							<button class="anim-btn anim-step-left" :class="{ disabled: !$core.view.legacyModelViewerAnimPaused }" @click="step_animation(-1)" title="Previous frame"></button>
							<button class="anim-btn" :class="$core.view.legacyModelViewerAnimPaused ? 'anim-play' : 'anim-pause'" @click="toggle_animation_pause()" :title="$core.view.legacyModelViewerAnimPaused ? 'Play' : 'Pause'"></button>
							<button class="anim-btn anim-step-right" :class="{ disabled: !$core.view.legacyModelViewerAnimPaused }" @click="step_animation(1)" title="Next frame"></button>
							<div class="anim-scrubber" @mousedown="start_scrub" @mouseup="end_scrub">
								<input type="range" min="0" :max="$core.view.legacyModelViewerAnimFrameCount - 1" :value="$core.view.legacyModelViewerAnimFrame" @input="seek_animation($event.target.value)" />
								<div class="anim-frame-display">{{ $core.view.legacyModelViewerAnimFrame }}</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<component :is="$components.MenuButton" :options="$core.view.menuButtonLegacyModels" :default="$core.view.config.exportLegacyModelFormat" @change="$core.view.config.exportLegacyModelFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_model"></component>
			</div>
			<div id="model-sidebar" class="sidebar">
				<span class="header">Preview</span>
				<label class="ui-checkbox" title="Automatically preview a model when selecting it">
					<input type="checkbox" v-model="$core.view.config.legacyModelsAutoPreview"/>
					<span>Auto Preview</span>
				</label>
				<label class="ui-checkbox" title="Automatically adjust camera when selecting a new model">
					<input type="checkbox" v-model="$core.view.legacyModelViewerAutoAdjust"/>
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
				<label class="ui-checkbox" title="Show model textures in the preview pane">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowTextures"/>
					<span>Show Textures</span>
				</label>
				<label class="ui-checkbox" title="Show a background color in the 3D viewport">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowBackground"/>
					<span>Show Background</span>
				</label>
				<template v-if="$core.view.legacyModelViewerActiveType === 'm2' || $core.view.legacyModelViewerActiveType === 'mdx'">
					<span class="header">Geosets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.modelViewerGeosets"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllGeosets(true, $core.view.modelViewerGeosets)">Enable All</a> / <a @click="$core.view.setAllGeosets(false, $core.view.modelViewerGeosets)">Disable All</a>
					</div>
				</template>
				<template v-if="$core.view.legacyModelViewerActiveType === 'wmo'">
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

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

		async export_model() {
			const user_selection = this.$core.view.selectionLegacyModels;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			await export_files(this.$core, user_selection);
		},

		toggle_animation_pause() {
			const renderer = active_renderer;
			if (!renderer)
				return;

			const paused = !this.$core.view.legacyModelViewerAnimPaused;
			this.$core.view.legacyModelViewerAnimPaused = paused;
			renderer.set_animation_paused?.(paused);
		},

		step_animation(delta) {
			if (!this.$core.view.legacyModelViewerAnimPaused)
				return;

			const renderer = active_renderer;
			if (!renderer)
				return;

			renderer.step_animation_frame?.(delta);
			this.$core.view.legacyModelViewerAnimFrame = renderer.get_animation_frame?.() || 0;
		},

		seek_animation(frame) {
			const renderer = active_renderer;
			if (!renderer)
				return;

			renderer.set_animation_frame?.(parseInt(frame));
			this.$core.view.legacyModelViewerAnimFrame = parseInt(frame);
		},

		start_scrub() {
			this._was_paused_before_scrub = this.$core.view.legacyModelViewerAnimPaused;
			if (!this._was_paused_before_scrub) {
				this.$core.view.legacyModelViewerAnimPaused = true;
				active_renderer?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			if (!this._was_paused_before_scrub) {
				this.$core.view.legacyModelViewerAnimPaused = false;
				active_renderer?.set_animation_paused?.(false);
			}
		}
	},

	async mounted() {
		this.$core.showLoadingScreen(2);

		try {
			await this.$core.progressLoadingScreen('Building legacy model list...');

			// get model files from mpq
			const mpq = this.$core.view.mpq;
			const all_files = mpq.getAllFiles();

			const model_files = all_files.filter(f => {
				const lower = f.toLowerCase();
				return lower.endsWith('.m2') || lower.endsWith('.mdx') || lower.endsWith('.wmo');
			});

			this.$core.view.listfileLegacyModels = model_files.sort();

			await this.$core.progressLoadingScreen('Initializing 3D preview...');

			// initialize model viewer context if not already present
			if (!this.$core.view.legacyModelViewerContext)
				this.$core.view.legacyModelViewerContext = Object.seal({ getActiveRenderer: () => active_renderer, gl_context: null, fitCamera: null });

			this.$core.hideLoadingScreen();
		} catch (error) {
			this.$core.hideLoadingScreen();
			log.write('Failed to initialize legacy models tab: %o', error);
			this.$core.setToast('error', 'Failed to initialize legacy models tab. Check the log for details.');
		}

		this.$core.view.$watch('legacyModelViewerAnimSelection', async selected_animation_id => {
			if (!active_renderer || !active_renderer.playAnimation || this.$core.view.legacyModelViewerAnims.length === 0)
				return;

			// reset animation state
			this.$core.view.legacyModelViewerAnimPaused = false;
			this.$core.view.legacyModelViewerAnimFrame = 0;
			this.$core.view.legacyModelViewerAnimFrameCount = 0;

			if (selected_animation_id !== null && selected_animation_id !== undefined) {
				if (selected_animation_id === 'none') {
					active_renderer?.stopAnimation?.();

					if (this.$core.view.legacyModelViewerAutoAdjust)
						requestAnimationFrame(() => this.$core.view.legacyModelViewerContext?.fitCamera?.());
					return;
				}

				const anim_info = this.$core.view.legacyModelViewerAnims.find(anim => anim.id == selected_animation_id);
				if (anim_info && anim_info.m2Index !== undefined && anim_info.m2Index >= 0) {
					log.write(`Playing legacy animation at index ${anim_info.m2Index}`);
					await active_renderer.playAnimation(anim_info.m2Index);

					// set frame count after animation is loaded
					this.$core.view.legacyModelViewerAnimFrameCount = active_renderer.get_animation_frame_count?.() || 0;

					if (this.$core.view.legacyModelViewerAutoAdjust)
						requestAnimationFrame(() => this.$core.view.legacyModelViewerContext?.fitCamera?.());
				}
			}
		});

		this.$core.view.$watch('selectionLegacyModels', async selection => {
			if (!this.$core.view.config.legacyModelsAutoPreview)
				return;

			const first = selection[0];
			if (!this.$core.view.isBusy && first && active_path !== first)
				preview_model(this.$core, first);
		});
	},

	getActiveRenderer: () => active_renderer
};
