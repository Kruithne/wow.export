/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// BUILD_RELEASE will be set globally by Terser during bundling allowing us
// to discern a production build. However, for debugging builds it will throw
// a ReferenceError without the following check. Any code that only runs when
// BUILD_RELEASE is set to false will be removed as dead-code during compile.
BUILD_RELEASE = typeof BUILD_RELEASE !== 'undefined';

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

// Imports
const os = require('os');
const path = require('path');
const constants = require('./js/constants');
const generics = require('./js/generics');
const updater = require('./js/updater');
const core = require('./js/core');
const listfile = require('./js/casc/listfile');
const log = require('./js/log');
const config = require('./js/config');
const tactKeys = require('./js/casc/tact-keys');
const blender = require('./js/blender');
const fsp = require('fs').promises;
const TestRunner = require('./js/iat/test-runner');
const ExportHelper = require('./js/casc/export-helper');
const textureRibbon = require('./js/ui/texture-ribbon');

require('./js/components/listbox');
require('./js/components/listboxb');
require('./js/components/itemlistbox');
require('./js/components/checkboxlist');
require('./js/components/menu-button');
require('./js/components/file-field');
require('./js/components/slider');
require('./js/components/model-viewer');
require('./js/components/map-viewer');
require('./js/components/resize-layer');

const TabTextures = require('./js/ui/tab-textures');
require('./js/ui/source-select');
require('./js/ui/tab-audio');
require('./js/ui/tab-videos');
require('./js/ui/tab-text.js');
require('./js/ui/tab-models');
require('./js/ui/tab-maps');
require('./js/ui/tab-items');

const win = nw.Window.get();
win.setProgressBar(-1); // Reset taskbar progress in-case it's stuck.
win.on('close', () => process.exit()); // Ensure we exit when window is closed.

// Prevent files from being dropped onto the window. These are over-written
// later but we disable here to prevent them working if init fails.
window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

// Launch DevTools for debug builds.
if (!BUILD_RELEASE)
	win.showDevTools();

// Force all links to open in the users default application.
document.addEventListener('click', function(e) {
	if (!e.target.matches('[data-external]'))
		return;

	e.preventDefault();
	nw.Shell.openExternal(e.target.getAttribute('data-external'));
});

(async () => {
	// Wait for the DOM to be loaded.
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

	// Append the application version to the title bar.
	document.title += ' v' + nw.App.manifest.version;

	// Interlink error handling for Vue.
	Vue.config.errorHandler = err => crash('ERR_VUE', err.message);

	// Initialize Vue.
	core.view = new Vue({
		el: '#container',
		data: core.view,
		methods: {
			/**
			 * Invoked when the user chooses to manually install the Blender add-on.
			 */
			openBlenderAddonFolder: function() {
				blender.openAddonDirectory();
			},

			/**
			 * Invoked when the user chooses to automatically install the Blender add-on.
			 */
			installBlenderAddon: function() {
				blender.startAutomaticInstall();
			},

			/**
			 * Opens the runtime application log from the application data directory.
			 */
			openRuntimeLog() {
				log.openRuntimeLog();
			},

			/**
			 * Initiate the integration tests.
			 */
			async runIntegrationTests() {
				this.setScreen('loading', true);

				this.loadingTitle = 'Running integration tests...';
				this.loadingProgress = 'Initializing';
				this.loadPct = 0;

				const runner = new TestRunner();
				await runner.run();

				this.showPreviousScreen();
				core.setToast('success', 'Integration tests have completed, see runtime log for results.', { 'View Log': () => log.openRuntimeLog() });

				// Reset the load progress (to hide Windows taskbar progress).
				this.loadPct = -1;
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
			 * Mark all geosets to the given state.
			 * @param {boolean} state 
			 */
			setAllGeosets: function(state) {
				if (this.modelViewerGeosets) {
					for (const node of this.modelViewerGeosets)
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
			 * Return a tag for a given product.
			 * @param {string} product 
			 */
			getProductTag: function(product) {
				const entry = constants.PRODUCTS.find(e => e.product === product);
				return entry ? entry.tag : 'Unknown';
			},

			/**
			 * Set the currently active screen.
			 * If `preserve` is true, the current screen ID will be pushed further onto the stack.
			 * showPreviousScreen() can be used to return to it. If false, overwrites screenStack[0].
			 * @param {string} screenID 
			 * @param {boolean} preserve
			 */
			setScreen: function(screenID, preserve = false) {
				this.loadPct = -1; // Ensure we reset if coming from a loading screen.
				
				if (preserve)
					this.screenStack.unshift(screenID);
				else
					this.$set(this.screenStack, 0, screenID);
			},

			/**
			 * Show the loading screen with a given message.
			 * @param {string} text Defaults to 'Loading, please wait'
			 */
			showLoadScreen: function(text) {
				this.setScreen('loading');
				this.loadingTitle = text || 'Loading, please wait...';
			},

			/**
			 * Remove the active screen from the screen stack, effectively returning to the
			 * 'previous' screen. Has no effect if there are no more screens in the stack.
			 */
			showPreviousScreen: function() {
				if (this.screenStack.length > 1)
					this.screenStack.shift();
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
			 * Displays the texture ribbon context menu with the given texture slot.
			 * @param {MouseEvent} $event
			 * @param {object} slot 
			 */
			showTextureRibbonContextMenu: function($event, slot) {
				this.textureRibbonActiveSlot = slot;
				
				const pos = this.textureRibbonContextXY;
				pos.x = $event.clientX;
				pos.y = $event.clientY;
			},

			/**
			 * Switches to the textures tab and filters for the given file.
			 * @param {number} fileDataID 
			 */
			goToTexture: function(fileDataID) {
				const view = core.view;
				view.setScreen('tab-textures');

				// Directly preview the requested file, even if it's not in the listfile.
				TabTextures.previewTextureByID(fileDataID);

				// Since we're doing a direct preview, we need to reset the users current
				// selection, so if they hit export, they get the expected result.
				view.selectionTextures.splice(0);

				// Despite direct preview, *attempt* to filter for the file as well.
				if (view.config.listfileShowFileDataIDs) {
					// If the user has fileDataIDs shown, filter by that.
					if (view.config.regexFilters)
						view.userInputFilterTextures = '\\[' + fileDataID + '\\]';
					else
						view.userInputFilterTextures = '[' + fileDataID + ']';
				} else {
					// Without fileDataIDs, lookup the texture name and filter by that.
					const fileName = listfile.getByID(fileDataID);
					if (fileName !== undefined)
						view.userInputFilterTextures = listfile.getByID(fileName);
					else if (view.config.enableUnknownFiles)
						view.userInputFilterTextures = listfile.formatUnknownFile(fileDataID, '.blp');
				}
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
			}
		},

		computed: {
			/**
			 * Returns true if the export directory contains spaces.
			 * @returns {boolean}
			 */
			isExportPathConcerning: function() {
				return !!this.config?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns true if the editing config directory contains spaces.
			 * @returns {boolean}
			 */
			isEditExportPathConcerning: function() {
				return !!this.configEdit?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns the currently 'active' screen, which is first on the stack.
			 */
			screen: function() {
				return this.screenStack[0];
			},

			/**
			 * Returns the cache size formatted as a file size.
			 */
			cacheSizeFormatted: function() {
				return generics.filesize(this.cacheSize);
			},

			/**
			 * Returns an Array of available locale keys.
			 */
			availableLocaleKeys: function() {
				return Object.keys(this.availableLocale.flags);
			},

			/**
			 * Return the locale key for the configured CASC locale.
			 */
			selectedLocaleKey: function() {
				for (const [key, flag] of Object.entries(this.availableLocale.flags)) {
					if (flag === this.config.cascLocale)
						return key;
				}

				return 'unUN';
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
			 * Invoked when the active 'screen' is changed.
			 * @param {string} val 
			 */
			screen: function(val) {
				core.events.emit('screen-' + val);
			},

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

	// Check for updates (without blocking).
	if (BUILD_RELEASE) {
		updater.checkForUpdates().then(updateAvailable => {
			if (updateAvailable) {
				// Update is available, prompt to update. If user declines,
				// begin checking the local Blender add-on version.
				core.setToast('info', 'A new update is available. You should update, it\'s probably really cool!', {
					'Update Now': () => updater.applyUpdate(),
					'Maybe Later': () => blender.checkLocalVersion()
				}, -1, false);
			} else {
				// No update available, start checking Blender add-on.
				blender.checkLocalVersion();
			}
		});
	} else {
		// Debug mode, go straight to Blender add-on check.
		blender.checkLocalVersion();
	}

	// Load the changelog when the user opens the screen.
	core.events.on('screen-changelog', () => {
		setImmediate(async () => {
			const element = document.getElementById('changelog-text');

			if (BUILD_RELEASE) {
				try {
					const text = await fsp.readFile('./src/CHANGELOG.md', 'utf8');
					element.textContent = text;
				} catch (e) {
					element.textContent = 'Error loading changelog';
				}
			} else {
				element.textContent = 'Cannot load changelog in DEBUG mode';
			}
		});
	});

	// Set source select as the currently active interface screen.
	core.view.setScreen('source-select');
})();