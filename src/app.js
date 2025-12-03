/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// BUILD_RELEASE will be set by the bundler during production builds allowing us
// to discern a production build. For debugging builds, process.env.BUILD_RELEASE
// will be undefined. Any code that only runs when BUILD_RELEASE is false will
// be removed as dead-code during compile.
BUILD_RELEASE = process.env.BUILD_RELEASE === 'true';

// check for --disable-auto-update flag
const DISABLE_AUTO_UPDATE = nw.App.argv.includes('--disable-auto-update');

/**
 * crash() is used to inform the user that the application has exploded.
 * It is purposely global and primitive as we have no idea what state
 * the application will be in when it is called.
 * @param {string} errorCode
 * @param {string} errorText
 */
let isCrashed = false;
crash = (errorCode, errorText) => {
	// Prevent a never-ending cycle of depression.
	if (isCrashed)
		return;

	isCrashed = true;

	// Replace the entire markup with just that from the <noscript> block.
	const errorMarkup = document.querySelector('noscript').innerHTML;
	const body = document.querySelector('body');
	body.innerHTML = errorMarkup;

	// Keep the logo, because that's cool.
	const logo = document.createElement('div');
	logo.setAttribute('id', 'logo-background');
	document.body.appendChild(logo);

	const setText = (id, text) => document.querySelector(id).textContent = text;

	// Show build version/flavour/ID.
	const manifest = nw.App.manifest;
	setText('#crash-screen-version', 'v' + manifest.version);
	setText('#crash-screen-flavour', manifest.flavour);
	setText('#crash-screen-build', manifest.guid);

	// Display our error code/text.
	setText('#crash-screen-text-code', errorCode);
	setText('#crash-screen-text-message', errorText);

	// getErrorDump is set as a global function by the log module.
	// This is used to get the contents of the runtime log without depending on the module.
	if (typeof getErrorDump === 'function')
		getErrorDump().then(data => setText('#crash-screen-log', data));

	// If we can, emit a global event to the application informing of the crash.
	if (core)
		core.events.emit('crash');
};

// Debugging reloader.
if (!BUILD_RELEASE) {
	window.addEventListener('keyup', e => {
		if (e.code === 'F5')
			chrome.runtime.reload();
	});
}

// Register crash handlers.
process.on('unhandledRejection', e => crash('ERR_UNHANDLED_REJECTION', e.message));
process.on('uncaughtException', e => crash('ERR_UNHANDLED_EXCEPTION', e.message));

const win = nw.Window.get();
// Launch DevTools for debug builds.
if (!BUILD_RELEASE)
	win.showDevTools();

// Imports
const os = require('os');
const path = require('path');
const constants = require('./js/constants');
const generics = require('./js/generics');
const updater = require('./js/updater');
const core = require('./js/core');
const listfile = require('./js/casc/listfile');
const dbd_manifest = require('./js/casc/dbd-manifest');
const cdnResolver = require('./js/casc/cdn-resolver');
const log = require('./js/log');
const config = require('./js/config');
const tactKeys = require('./js/casc/tact-keys');
const fsp = require('fs').promises;
const ExportHelper = require('./js/casc/export-helper');
const ExternalLinks = require('./js/external-links');
const textureRibbon = require('./js/ui/texture-ribbon');
const Shaders = require('./js/3D/Shaders');

const Vue = require('vue/dist/vue.cjs.js');
window.Vue = Vue;

const modules = require('./js/modules');

win.setProgressBar(-1); // Reset taskbar progress in-case it's stuck.
// ensure clean exit when window is closed (skip in dev to avoid nw.js devtools bug)
if (BUILD_RELEASE)
	win.on('close', () => process.exit());

// Prevent files from being dropped onto the window. These are over-written
// later but we disable here to prevent them working if init fails.
window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

// Force all links to open in the users default application.
document.addEventListener('click', function(e) {
	const kbElement = e.target.closest('[data-kb-link]');
	if (kbElement) {
		e.preventDefault();
		const kb_id = kbElement.getAttribute('data-kb-link');
		modules.tab_help.open_article(kb_id);
		return;
	}

	const externalElement = e.target.closest('[data-external]');
	if (!externalElement)
		return;

	e.preventDefault();
	ExternalLinks.open(externalElement.getAttribute('data-external'));
});

(async () => {
	// Wait for the DOM to be loaded.
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

	// Append the application version to the title bar.
	document.title += ' v' + nw.App.manifest.version;

	// Initialize Vue.
	const app = Vue.createApp({
		data() {
			return core.makeNewView();
		},
		created() {
			core.view = this;
		},
		methods: {
			/**
			 * Opens the runtime application log from the application data directory.
			 */
			openRuntimeLog() {
				log.openRuntimeLog();
			},

			/**
			 * Reloads all stylesheets in the document.
			 */
			reloadStylesheet() {
				const sheets = document.querySelectorAll('link[rel="stylesheet"]');
				for (const sheet of sheets)
					sheet.href = sheet.getAttribute('data-href') + '?v=' + Date.now();
			},

			/**
			 * Reload the currently active module.
			 */
			reloadActiveModule() {
				modules.reloadActiveModule();
			},

			/**
			 * Reload all loaded modules.
			 */
			reloadAllModules() {
				modules.reloadAllModules();
			},

			/**
			 * Mark all WMO groups to the given state.
			 * @param {boolean} state 
			 */
			setAllWMOGroups: function(state) {
				if (this.modelViewerWMOGroups) {
					for (const node of this.modelViewerWMOGroups)
						node.checked = state;
				}
			},

			/**
			 * Toggle UV layer for the main model viewer.
			 * @param {string} layerName
			 */
			toggleUVLayer: function(layerName) {
				core.events.emit('toggle-uv-layer', layerName);
			},

			/**
			 * Mark all geosets to the given state.
			 * @param {boolean} state
			 * @param {object} geosets
			 */
			setAllGeosets: function(state, geosets) {
				if (geosets) {
					for (const node of geosets)
						node.checked = state;
				}
			},

			/**
			 * Mark all item types to the given state.
			 * @param {boolean} state
			 */
			setAllItemTypes: function(state) {
				for (const entry of this.itemViewerTypeMask)
					entry.checked = state;
			},

			/**
			 * Mark all item qualities to the given state.
			 * @param {boolean} state
			 */
			setAllItemQualities: function(state) {
				for (const entry of this.itemViewerQualityMask)
					entry.checked = state;
			},

			/**
			 * Return a tag for a given product.
			 * @param {string} product 
			 */
			getProductTag: function(product) {
				const entry = constants.PRODUCTS.find(e => e.product === product);
				return entry ? entry.tag : 'Unknown';
			},

			setActiveModule: function(module_name) {
				modules.setActive(module_name);
			},

			handleContextMenuClick: function(opt) {
				if (opt.action?.handler)
					opt.action.handler();
				else
					modules.setActive(opt.id);
			},

			/**
			 * Invoked when a toast option is clicked.
			 * The tag is passed to our global event emitter.
			 * @param {string} tag 
			 */
			handleToastOptionClick: function(func) {
				this.toast = null;
				
				if (typeof func === 'function')
					func();
			},

			/**
			 * Invoked when a user cancels a model override filter.
			 */
			removeOverrideModels: function() {
				this.overrideModelList = [];
				this.overrideModelName = '';
			},

			/**
			 * Invoked when a user cancels a texture override filter.
			 */
			removeOverrideTextures: function() {
				this.overrideTextureList = [];
				this.overrideTextureName = '';
			},

			/**
			 * Invoked when the user manually selects a CDN region.
			 * @param {object} region 
			 */
			setSelectedCDN: function(region) {
				this.selectedCDNRegion = region;
				this.lockCDNRegion = true;
				this.config.sourceSelectUserRegion = region.tag;
				cdnResolver.startPreResolution(region.tag);
			},

			/**
			 * Emit an event using the global event emitter.
			 * @param {string} tag
			 * @param {object} event
			 */
			click: function(tag, event, ...params) {
				if (!event.target.classList.contains('disabled'))
					core.events.emit('click-' + tag, ...params);
			},

			/**
			 * Pass-through function to emit events from reactive markup.
			 * @param {string} tag 
			 * @param  {...any} params 
			 */
			emit: function(tag, ...params) {
				core.events.emit(tag, ...params);
			},

			/**
			 * Hide the toast bar.
			 * @param {boolean} userCancel
			 */
			hideToast: function(userCancel = false) {
				core.hideToast(userCancel)
			},

			/**
			 * Restart the application.
			 */
			restartApplication: function() {
				chrome.runtime.reload();
			},

			/**
			 * Invoked when the texture ribbon element on the model viewer
			 * fires a resize event.
			 */
			onTextureRibbonResize: function(width) {
				textureRibbon.onResize(width);
			},

			/**
			 * Toggle UV layer visibility.
			 * @param {string} layerName - Name of the UV layer to toggle
			 */
			toggleUVLayer: function(layerName) {
				core.events.emit('toggle-uv-layer', layerName);
			},
			
			/**
			 * Switches to the textures tab and filters for the given file.
			 * @param {number} fileDataID
			 */
			goToTexture: function(fileDataID) {
				const view = core.view;
				modules.tab_textures.setActive();

				// Directly preview the requested file, even if it's not in the listfile.
				modules.tab_textures.previewTextureByID(core, fileDataID);

				// Since we're doing a direct preview, we need to reset the users current
				// selection, so if they hit export, they get the expected result.
				view.selectionTextures.splice(0);

				// If the user has fileDataIDs shown, filter by that.
				if (view.config.regexFilters)
					view.userInputFilterTextures = '\\[' + fileDataID + '\\]';
				else
					view.userInputFilterTextures = '[' + fileDataID + ']';
			},

			/**
			 * Copy given data as text to the system clipboard.
			 * @param {string} data 
			 */
			copyToClipboard: function(data) {
				nw.Clipboard.get().set(data.toString(), 'text');
			},

			/**
			 * Get the external export path for a given file.
			 * @param {string} file 
			 * @returns {string}
			 */
			getExportPath: function(file) {
				return ExportHelper.getExportPath(file);
			},

			/**
			 * Returns a reference to the external links module.
			 * @returns {ExternalLinks}
			 */
			getExternalLink: function() {
				return ExternalLinks;
			}
		},

		computed: {
			/**
			 * Returns the location of the last export manifest.
			 * @returns {string}
			 */
			lastExportPath: function() {
				if (this.config.lastExportFile.length > 0)
					return this.config.lastExportFile;

				return constants.LAST_EXPORT;
			},

			/**
			 * Return the formatted duration of the selected track on the sound player.
			 */
			soundPlayerDurationFormatted: function() {
				return generics.formatPlaybackSeconds(this.soundPlayerDuration);
			},

			/**
			 * Return the formatted current seek of the selected track on the sound player.
			 */
			soundPlayerSeekFormatted: function() {
				return generics.formatPlaybackSeconds(this.soundPlayerSeek * this.soundPlayerDuration);
			},

			/**
			 * Returns the maximum amount of pages needed for the texture ribbon.
			 * @returns {number}
			 */
			textureRibbonMaxPages: function() {
				return Math.ceil(this.textureRibbonStack.length / this.textureRibbonSlotCount);
			},

			/**
			 * Returns the texture ribbon stack array subject to paging.
			 * @returns {Array}
			 */
			textureRibbonDisplay: function() {
				const startIndex = this.textureRibbonPage * this.textureRibbonSlotCount;
				return this.textureRibbonStack.slice(startIndex, startIndex + this.textureRibbonSlotCount);
			}
		},

		watch: {
			/**
			 * Invoked when the active loading percentage is changed.
			 * @param {float} val
			 */
			loadPct: function(val) {
				win.setProgressBar(val);
			},

			/**
			 * Invoked when the core CASC instance is changed.
			 */
			casc: function() {
				core.events.emit('casc-source-changed');
			}
		}
	});

	// Interlink error handling for Vue.
	app.config.errorHandler = err => crash('ERR_VUE', err.message);

	modules.register_components(app);
	app.mount('#container');

	// dynamic interface scaling for smaller displays
	const SCALE_THRESHOLD_W = 1120;
	const SCALE_THRESHOLD_H = 700;

	const update_container_scale = () => {
		const container = document.getElementById('container');
		const win_w = window.innerWidth;
		const win_h = window.innerHeight;

		const scale_w = win_w < SCALE_THRESHOLD_W ? win_w / SCALE_THRESHOLD_W : 1;
		const scale_h = win_h < SCALE_THRESHOLD_H ? win_h / SCALE_THRESHOLD_H : 1;

		if (scale_w < 1 || scale_h < 1) {
			container.style.transform = `scale(${scale_w}, ${scale_h})`;
			container.style.width = scale_w < 1 ? `${SCALE_THRESHOLD_W}px` : '';
			container.style.height = scale_h < 1 ? `${SCALE_THRESHOLD_H}px` : '';
		} else {
			container.style.transform = '';
			container.style.width = '';
			container.style.height = '';
		}
	};

	window.addEventListener('resize', update_container_scale);
	update_container_scale();

	await modules.initialize(core);

	// register static context menu options
	modules.registerContextMenuOption('runtime-log', 'Open Runtime Log', 'timeline.svg', () => log.openRuntimeLog());
	modules.registerContextMenuOption('restart', 'Restart wow.export', 'arrow-rotate-left.svg', () => chrome.runtime.reload());
	modules.registerContextMenuOption('reload-style', 'Reload Styling', 'palette.svg', () => core.view.reloadStylesheet(), true);
	modules.registerContextMenuOption('reload-shaders', 'Reload Shaders', 'cube.svg', () => Shaders.reload_all(), true);
	modules.registerContextMenuOption('reload-active', 'Reload Active Module', 'gear.svg', () => modules.reloadActiveModule(), true);
	modules.registerContextMenuOption('reload-all', 'Reload All Modules', 'gear.svg', () => modules.reloadAllModules(), true);

	// watch activeModule and close context menus when it changes
	core.view.$watch('activeModule', () => {
		const contextMenus = core.view.contextMenus;
		for (const [key, value] of Object.entries(contextMenus)) {
			if (value === true)
				contextMenus[key] = false;
			else if (value !== false)
				contextMenus[key] = null;
		}
	});

	// Log some basic information for potential diagnostics.
	const manifest = nw.App.manifest;
	const cpus = os.cpus();
	log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
	log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform, os.arch, cpus[0].model, cpus.length, generics.filesize(os.freemem), generics.filesize(os.totalmem));
	log.write('INSTALL_PATH %s DATA_PATH %s', constants.INSTALL_PATH, constants.DATA_PATH);

	// Load configuration.
	await config.load();

	// Set-up default export directory if none configured.
	if (core.view.config.exportDirectory === '') {
		core.view.config.exportDirectory = path.join(os.homedir(), 'wow.export');
		log.write('No export directory set, setting to %s', core.view.config.exportDirectory);
	}

	listfile.preload();
	dbd_manifest.preload();

	// Set-up proper drag/drop handlers.
	let dropStack = 0;
	window.ondragenter = e => {
		e.preventDefault();

		// Converting local files while busy shouldn't end badly, but it seems
		// weird to let people do this on loading screens.
		if (core.view.isBusy)
			return false;

		dropStack++;

		// We're already showing a prompt, don't re-process it.
		if (core.view.fileDropPrompt !== null)
			return false;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			const handler = core.getDropHandler(files[0].path);
			if (handler) {
				// Since dataTransfer.files is a FileList, we need to iterate it the old fashioned way.
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
			const handler = core.getDropHandler(files[0].path);
			if (handler) {
				// Since dataTransfer.files is a FileList, we need to iterate it the old fashioned way.
				const include = [];
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some(ext => check.endsWith(ext)))
						include.push(file.path);
				}

				if (include.length > 0)
					handler.process(include);
			}
		}
		return false;
	};

	window.ondragleave = e => {
		e.preventDefault();

		// Window drag events trigger for all elements. Ensure that there is currently
		// nothing being dragged once the dropStack is empty.
		dropStack--;
		if (dropStack === 0)
			core.view.fileDropPrompt = null;
	};

	//window.ondragover = e => { e.preventDefault(); return false; };
	//window.ondrop = e => { e.preventDefault(); return false; };

	// Load cachesize, a file used to track the overall size of the cache directory
	// without having to calculate the real size before showing to users. Fast and reliable.
	fsp.readFile(constants.CACHE.SIZE, 'utf8').then(data => {
		core.view.cacheSize = Number(data) || 0;
	}).catch(() => {}).finally(() => {
		let updateTimer = -1;

		// Create a watcher programmatically *after* assigning the initial value
		// to prevent a needless file write by triggering itself during init.
		core.view.$watch('cacheSize', function(nv) {
			// Clear any existing timer running.
			clearTimeout(updateTimer);

			// We buffer this call by SIZE_UPDATE_DELAY so that we're not writing
			// to the file constantly during heavy cache usage. Postponing until
			// next tick would not help due to async and potential IO/net delay.
			updateTimer = setTimeout(() => {
				fsp.writeFile(constants.CACHE.SIZE, nv.toString(), 'utf8');
			}, constants.CACHE.SIZE_UPDATE_DELAY);
		});
	});

	// Load/update BLTE decryption keys.
	tactKeys.load();

	// Check for updates.
	if (BUILD_RELEASE && !DISABLE_AUTO_UPDATE) {
		core.showLoadingScreen(1, 'Checking for updates...');

		updater.checkForUpdates().then(updateAvailable => {
			if (updateAvailable) {
				updater.applyUpdate();
			} else {
				core.hideLoadingScreen();
				modules.source_select.setActive();

				// No update available, start checking Blender add-on.
				modules.tab_blender.checkLocalVersion();
			}
		});
	} else {
		// debug mode or auto-update disabled, skip to blender add-on check
		modules.tab_blender.checkLocalVersion();
	}

	// Load what's new HTML on app start
	(async () => {
		try {
			const whats_new_path = BUILD_RELEASE ? './src/whats-new.html' : './src/whats-new.html';
			const html = await fsp.readFile(whats_new_path, 'utf8');
			core.view.whatsNewHTML = html;
		} catch (e) {
			log.write('failed to load whats-new.html: %o', e);
		}
	})();

	// Set source select as the currently active interface screen.
	modules.source_select.setActive();
})();