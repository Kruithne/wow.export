import * as Vue from 'vue';
import { app, config as rpc_config, log as rpc_log, on, off, platform as rpc_platform } from './rpc.js';
import { MSG } from '../../rpc/schema.js';
import core from '../../js/core.js';
import modules from '../../js/modules.js';
import constants from '../../js/constants.js';
import * as config from '../../js/config.js';
import * as platform from '../../js/platform.js';
import ExternalLinks from '../../js/external-links.js';
import ExportHelper from '../../js/export-helper.js';
import generics from '../../js/generics.js';
import log from '../../js/log.js';
import textureRibbon from '../../js/ui/texture-ribbon.js';
import { reload_all as reload_shaders } from '../../js/3D/Shaders.js';

let is_crashed = false;

const crash = (error_code, error_text) => {
	if (is_crashed)
		return;

	is_crashed = true;

	const error_markup = document.querySelector('noscript').innerHTML;
	const body = document.querySelector('body');
	body.innerHTML = error_markup;

	const logo = document.createElement('div');
	logo.setAttribute('id', 'logo-background');
	document.body.appendChild(logo);

	const set_text = (id, text) => document.querySelector(id).textContent = text;

	const manifest = platform.get_manifest();
	set_text('#crash-screen-version', 'v' + manifest.version);
	set_text('#crash-screen-flavour', manifest.flavour);
	set_text('#crash-screen-build', manifest.guid);

	set_text('#crash-screen-text-code', error_code);
	set_text('#crash-screen-text-message', error_text);

	if (core?.events)
		core.events.emit('crash');
};

window.addEventListener('error', (e) => crash('ERR_UNHANDLED', e.message));
window.addEventListener('unhandledrejection', (e) => crash('ERR_UNHANDLED_REJECTION', e.reason?.message ?? String(e.reason)));

window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

document.addEventListener('click', (e) => {
	const kb_element = e.target.closest('[data-kb-link]');
	if (kb_element) {
		e.preventDefault();
		const kb_id = kb_element.getAttribute('data-kb-link');
		modules.tab_help.open_article(kb_id);
		return;
	}

	const external_element = e.target.closest('[data-external]');
	if (!external_element)
		return;

	e.preventDefault();
	ExternalLinks.open(external_element.getAttribute('data-external'));
});

(async () => {
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

	await platform.init();
	await constants.init();

	document.title += ' v' + platform.get_version();

	const vue_app = Vue.createApp({
		data() {
			return core.makeNewView();
		},
		created() {
			core.view = this;
		},
		methods: {
			openRuntimeLog() {
				log.openRuntimeLog();
			},

			reloadStylesheet() {
				const sheets = document.querySelectorAll('link[rel="stylesheet"]');
				for (const sheet of sheets)
					sheet.href = sheet.getAttribute('data-href') + '?v=' + Date.now();
			},

			setAllWMOGroups(state) {
				if (this.modelViewerWMOGroups) {
					for (const node of this.modelViewerWMOGroups)
						node.checked = state;
				}
			},

			setAllDecorGeosets(state) {
				if (this.decorViewerGeosets) {
					for (const node of this.decorViewerGeosets)
						node.checked = state;
				}
			},

			setAllDecorWMOGroups(state) {
				if (this.decorViewerWMOGroups) {
					for (const node of this.decorViewerWMOGroups)
						node.checked = state;
				}
			},

			setAllCreatureGeosets(state) {
				if (this.creatureViewerGeosets) {
					for (const node of this.creatureViewerGeosets)
						node.checked = state;
				}
			},

			setAllCreatureEquipment(state) {
				if (this.creatureViewerEquipment) {
					for (const node of this.creatureViewerEquipment)
						node.checked = state;
				}
			},

			setAllCreatureWMOGroups(state) {
				if (this.creatureViewerWMOGroups) {
					for (const node of this.creatureViewerWMOGroups)
						node.checked = state;
				}
			},

			toggleUVLayer(layer_name) {
				core.events.emit('toggle-uv-layer', layer_name);
			},

			setAllGeosets(state, geosets) {
				if (geosets) {
					for (const node of geosets)
						node.checked = state;
				}
			},

			setAllDecorCategories(state) {
				for (const entry of this.decorCategoryMask)
					entry.checked = state;
			},

			setDecorCategoryGroup(category_id, state) {
				for (const entry of this.decorCategoryMask) {
					if (entry.categoryID === category_id)
						entry.checked = state;
				}
			},

			setAllItemTypes(state) {
				for (const entry of this.itemViewerTypeMask)
					entry.checked = state;
			},

			setAllItemQualities(state) {
				for (const entry of this.itemViewerQualityMask)
					entry.checked = state;
			},

			getProductTag(product) {
				const entry = constants.PRODUCTS.find(e => e.product === product);
				return entry ? entry.tag : 'Unknown';
			},

			setActiveModule(module_name) {
				modules.setActive(module_name);
			},

			handleContextMenuClick(opt) {
				if (opt.action?.handler)
					opt.action.handler();
				else
					modules.setActive(opt.id);
			},

			handleToastOptionClick(func) {
				this.toast = null;
				if (typeof func === 'function')
					func();
			},

			removeOverrideModels() {
				this.overrideModelList = [];
				this.overrideModelName = '';
			},

			removeOverrideTextures() {
				this.overrideTextureList = [];
				this.overrideTextureName = '';
			},

			setSelectedCDN(region) {
				this.selectedCDNRegion = region;
				this.lockCDNRegion = true;
				this.config.sourceSelectUserRegion = region.tag;
			},

			click(tag, event, ...params) {
				if (!event.target.classList.contains('disabled'))
					core.events.emit('click-' + tag, ...params);
			},

			emit(tag, ...params) {
				core.events.emit(tag, ...params);
			},

			hideToast(user_cancel = false) {
				core.hideToast(user_cancel);
			},

			restartApplication() {
				location.reload();
			},

			onTextureRibbonResize(width) {
				textureRibbon.onResize(width);
			},

			goToTexture(fileDataID) {
				modules.tab_textures.setActive();
				modules.tab_textures.previewTextureByID(core, fileDataID);

				core.view.selectionTextures.splice(0);

				if (core.view.config.regexFilters)
					core.view.userInputFilterTextures = '\\[' + fileDataID + '\\]';
				else
					core.view.userInputFilterTextures = '[' + fileDataID + ']';
			},

			copyToClipboard(data) {
				platform.clipboard_write_text(data.toString());
			},

			getExportPath(file) {
				return ExportHelper.getExportPath(file);
			},

			getExternalLink() {
				return ExternalLinks;
			}
		},

		computed: {
			soundPlayerDurationFormatted() {
				return generics.formatPlaybackSeconds(this.soundPlayerDuration);
			},

			soundPlayerSeekFormatted() {
				return generics.formatPlaybackSeconds(this.soundPlayerSeek * this.soundPlayerDuration);
			},

			textureRibbonMaxPages() {
				return Math.ceil(this.textureRibbonStack.length / this.textureRibbonSlotCount);
			},

			textureRibbonDisplay() {
				const start = this.textureRibbonPage * this.textureRibbonSlotCount;
				return this.textureRibbonStack.slice(start, start + this.textureRibbonSlotCount);
			}
		},

		watch: {
			// electrobun has no taskbar progress API; progress is shown in-app
			casc() {
				core.events.emit('casc-source-changed');
			}
		}
	});

	vue_app.config.errorHandler = err => crash('ERR_VUE', err.message);

	modules.register_components(vue_app);
	vue_app.mount('#container');

	const SCALE_THRESHOLD_W = 1120;
	const SCALE_THRESHOLD_H = 700;

	const update_container_scale = () => {
		const container = document.getElementById('container');
		const win_w = window.innerWidth;
		const win_h = window.innerHeight;

		const scale_w = win_w < SCALE_THRESHOLD_W ? win_w / SCALE_THRESHOLD_W : 1;
		const scale_h = win_h < SCALE_THRESHOLD_H ? win_h / SCALE_THRESHOLD_H : 1;

		if (scale_w < 1 || scale_h < 1) {
			container.style.transform = 'scale(' + scale_w + ', ' + scale_h + ')';
			container.style.width = scale_w < 1 ? SCALE_THRESHOLD_W + 'px' : '';
			container.style.height = scale_h < 1 ? SCALE_THRESHOLD_H + 'px' : '';
		} else {
			container.style.transform = '';
			container.style.width = '';
			container.style.height = '';
		}
	};

	window.addEventListener('resize', update_container_scale);
	update_container_scale();

	await modules.initialize(core);

	modules.registerContextMenuOption('runtime-log', 'Open Runtime Log', 'timeline.svg', () => log.openRuntimeLog());
	modules.registerContextMenuOption('restart', 'Restart wow.export', 'arrow-rotate-left.svg', () => location.reload());
	modules.registerContextMenuOption('reload-style', 'Reload Styling', 'palette.svg', () => core.view.reloadStylesheet(), true);
	modules.registerContextMenuOption('reload-shaders', 'Reload Shaders', 'cube.svg', () => reload_shaders(), true);
	modules.registerContextMenuOption('reload-active', 'Reload Active Module', 'arrow-rotate-left.svg', () => location.reload(), true);
	modules.registerContextMenuOption('reload-all', 'Reload All Modules', 'arrow-rotate-left.svg', () => location.reload(), true);

	core.view.$watch('activeModule', () => {
		const ctx = core.view.contextMenus;
		for (const [key, value] of Object.entries(ctx)) {
			if (value === true)
				ctx[key] = false;
			else if (value !== false)
				ctx[key] = null;
		}
	});

	const manifest = platform.get_manifest();
	log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);

	await config.load();

	if (core.view.config.exportDirectory === '') {
		core.view.config.exportDirectory = 'wow.export';
		log.write('No export directory set, using default');
	}

	on(MSG.TOAST, ({ message, type }) => {
		core.setToast(type ?? 'info', message);
	});

	on(MSG.LOADING_SCREEN, ({ visible, steps }) => {
		if (visible)
			core.showLoadingScreen(steps);
		else
			core.hideLoadingScreen();
	});

	on(MSG.LOADING_PROGRESS, ({ message }) => {
		core.progressLoadingScreen(message);
	});

	let drop_stack = 0;
	window.ondragenter = e => {
		e.preventDefault();

		if (core.view.isBusy)
			return false;

		drop_stack++;

		if (core.view.fileDropPrompt !== null)
			return false;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			const handler = core.getDropHandler(files[0].name);
			if (handler) {
				let count = 0;
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some(ext => check.endsWith(ext)))
						count++;
				}

				if (count > 0)
					core.view.fileDropPrompt = handler.prompt(count);
			} else {
				core.view.fileDropPrompt = 'That file cannot be converted.';
			}
		}

		return false;
	};

	window.ondrop = e => {
		e.preventDefault();
		core.view.fileDropPrompt = null;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			const handler = core.getDropHandler(files[0].name);
			if (handler) {
				const include = [];
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some(ext => check.endsWith(ext)))
						include.push(file.name);
				}

				if (include.length > 0)
					handler.process(include);
			}
		}
		return false;
	};

	window.ondragleave = e => {
		e.preventDefault();
		drop_stack--;
		if (drop_stack === 0)
			core.view.fileDropPrompt = null;
	};

	app.get_cache_size().then(size => {
		core.view.cacheSize = size || 0;
	}).catch(() => {});

	app.check_update().then(async (update) => {
		if (!update?.updateAvailable)
			return;

		core.setToast('progress', 'Downloading update v' + update.version + '...', null, -1, false);

		const on_status = (e) => {
			if (e.progress !== undefined)
				core.setToast('progress', 'Downloading update v' + update.version + '... ' + Math.round(e.progress) + '%', null, -1, false);
		};

		on(MSG.UPDATE_STATUS, on_status);

		try {
			const result = await app.download_update();
			off(MSG.UPDATE_STATUS, on_status);

			if (!result.success) {
				core.setToast('error', 'Update download failed: ' + (result.error ?? 'unknown error'), null, -1, true);
				return;
			}

			core.setToast('info', 'Update v' + update.version + ' is ready to install.', {
				'Restart Now': () => app.apply_update(),
				'Later': null
			}, -1, true);
		} catch (e) {
			off(MSG.UPDATE_STATUS, on_status);
			core.setToast('error', 'Update failed: ' + e.message, null, -1, true);
		}
	}).catch(() => {});

	// load what's new html
	fetch('whats-new.html').then(r => r.text()).then(html => {
		core.view.whatsNewHTML = html;
	}).catch(e => {
		log.write('failed to load whats-new.html: %s', e.message);
	});

	modules.source_select.setActive();

	modules.tab_blender.checkLocalVersion();
})();
