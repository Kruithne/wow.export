/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This is the main entry point for the application. This context/scope will be mixed with
// the browser context, so everything exposed here will be accessible from the browser
// and vice-versa.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { win } from './nwjs';

import Updater from './updater';
import Blender from './blender';
import ExternalLinks from './external-links';
import Constants from './constants';
import Log from './log';
import Config from './config';
import TactKeys from './casc/tact-keys';
import State from './state';
import Events from './events';
import CrashHandler from './crash-handler';
import ProgressObject from './progress-object';

import { createApp, defineComponent, watch, ref } from 'vue';
import { LocaleFlags } from './casc/locale-flags';
import { CDNRegion } from './ui/source-select'; // NIT: Better place for this.
import { filesize, formatPlaybackSeconds, redraw } from './generics';

import * as TextureRibbon from './ui/texture-ribbon';
import Listfile from './casc/listfile';

import { previewTextureByID } from './ui/tab-textures';
import { viewItemModels, viewItemTextures } from './ui/tab-items';

// Import UI modules as side-effects.
import './ui/source-select';
import './ui/tab-textures';
import './ui/tab-items';
import './ui/tab-audio';
import './ui/tab-models';
import './ui/tab-maps';
import './ui/tab-install';
import './ui/tab-data';
import './ui/tab-raw';
import './ui/tab-text';
import './ui/tab-videos';

import ComponentCheckboxList from './components/checkboxlist';
import ComponentContextMenu from './components/context-menu';
import ComponentDataTable from './components/data-table';
import ComponentFileField from './components/file-field';
import ComponentItemListBox from './components/itemlistbox';
import ComponentListBox from './components/listbox';
import ComponentListBoxB from './components/listboxb';
import ComponentMapViewer from './components/map-viewer';
import ComponentModelViewer from './components/model-viewer';
import ComponentMenuButton from './components/menu-button';
import ComponentResizeLayer from './components/resize-layer';
import ComponentSlider from './components/slider';

import ExportHelper from './casc/export-helper';

type ToastType = 'info' | 'success' | 'warning' | 'error';
type DropHandler = { ext: Array<string>; prompt: () => string; process: (file: File) => Promise<void>; };

// Register Node.js error handlers.
process.on('unhandledRejection', CrashHandler.handleUnhandledRejection);
process.on('uncaughtException', CrashHandler.handleUncaughtException);

// The `File` class does not implement the `path` property in the official File API.
// However, nw.js adds this property to get the native path of a file.
// See: https://developer.mozilla.org/en-US/docs/Web/API/File
// See: https://docs.nwjs.io/en/latest/References/Changes%20to%20DOM/#fileitempath
interface NWFile {
	path: string;
}

(async (): Promise<void> => {
	// Prevent files from being dropped onto the window. These are over-written
	// later but we disable here to prevent them working if init fails.
	window.ondragover = (e: DragEvent): boolean => {
		e.preventDefault(); return false;
	};
	window.ondrop = (e: DragEvent): boolean => {
		e.preventDefault(); return false;
	};

	// Reset taskbar progress in-case it's stuck.
	win.setProgressBar(-1);

	// Ensure we exit when the window is closed.
	win.on('close', () => process.exit(0));

	if (process.env.NODE_ENV === 'development') {
		// Open DevTools if we're in debug mode.
		win.showDevTools();

		// Add a quick-reload keybinding.
		document.addEventListener('keydown', (e) => {
			if (e.key === 'F5')
				chrome.runtime.reload();
		});
	}

	// Force all links to open in the users default application.
	document.addEventListener('click', function(e) {
		const target = e.target as HTMLAnchorElement;
		if (!target.matches('[data-external]'))
			return;

		e.preventDefault();
		ExternalLinks.openExternalLink(target.getAttribute('data-external'));
	});

	// Wait for the DOM to be loaded.
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

	// Append the application version to the title bar.
	document.title += ' v' + nw.App.manifest.version;

	const manifest = nw.App.manifest;
	const cpus = os.cpus();

	Log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
	Log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform(), os.arch(), cpus[0].model, cpus.length, filesize(os.freemem()), filesize(os.totalmem()));
	Log.write('INSTALL_PATH %s DATA_PATH %s', Constants.INSTALL_PATH, Constants.DATA_PATH);

	const app = createApp({
		el: '#container',
		data: () => {
			return {
				screenStack: [], // Controls the currently active interface screen.
				isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
				isDebugBuild: process.env.NODE_ENV === 'development', // True if in development environment.
				loadingProgress: '', // Sets the progress text for the loading screen.
				loadingTitle: '', // Sets the title text for the loading screen.
				loadPct: -1, // Controls active loading bar percentage.
				toast: null, // Controls the currently active toast bar.
				cdnRegions: [], // CDN region data.
				selectedCDNRegion: null, // Active CDN region.
				lockCDNRegion: false, // If true, do not programmatically alter the selected CDN region.
				config: {}, // Will contain default/user-set configuration. Use config module to operate.
				configEdit: {}, // Temporary configuration clone used during user configuration editing.
				availableLocalBuilds: null, // Array containing local builds to display during source select.
				availableRemoteBuilds: null, // Array containing remote builds to display during source select.
				casc: null, // Active CASC instance.
				cacheSize: 0, // Active size of the user cache.
				userInputTactKey: '', // Value of manual tact key field.
				userInputTactKeyName: '', // Value of manual tact key name field.
				userInputFilterTextures: '', // Value of the 'filter' field for textures.
				userInputFilterSounds: '', // Value of the 'filter' field for sounds/music.
				userInputFilterVideos: '', // Value of the 'filter' field for video files.
				userInputFilterText: '', // Value of the 'filter' field for text files.
				userInputFilterModels: '', // Value of the 'filter' field for models.
				userInputFilterMaps: '', // Value of the 'filter' field for maps.
				userInputFilterItems: '', // Value of the 'filter' field of items.
				userInputFilterDB2s: '', // Value of the 'filter' field of DBs.
				userInputFilterRaw: '', // Value of the 'filter' field for raw files.
				userInputFilterInstall: '', // Value of the 'filter' field for install files.
				selectionTextures: [], // Current user selection of texture files.
				selectionModels: [], // Current user selection of models.
				selectionSounds: [], // Current user selection of sounds.
				selectionVideos: [],  // Current user selection of videos.
				selectionText: [], // Current user selection of text files.
				selectionMaps: [], // Current user selection of maps.
				selectionItems: [], // Current user selection of items.
				selectionDB2s: [], // Current user selection of DB2s.
				selectionRaw: [], // Current user selection of raw files.
				selectionInstall: [], // Current user selection of install files.
				listfileTextures: [], // Filtered listfile for texture files.
				listfileSounds: [], // Filtered listfile for sound files.
				listfileVideos: [], // Filtered listfile for video files.
				listfileText: [], // Filtered listfile for text files.
				listfileModels: [], // Filtered listfile for M2/WMO models.
				listfileItems: [], // Filtered item entries.
				listfileDB2s: [], // Filtered DB2 entries.
				listfileRaw: [], // Full raw file listfile.
				listfileInstall: [], // Filtered listfile for install files.
				installTags: [], // Install manifest tags.
				tableBrowserHeaders: [], // DB2 headers
				tableBrowserRows: [], // DB2 rows
				fileDropPrompt: null, // Prompt to display for file drag/drops.
				textViewerSelectedText: '', // Active text for the text viewer.
				soundPlayerSeek: 0, // Current seek of the sound player.
				soundPlayerState: false, // Playing state of the sound player.
				soundPlayerTitle: 'No File Selected', // Name of the currently playing sound track.
				soundPlayerDuration: 0, // Duration of the currently playing sound track.
				modelViewerContext: null, // 3D context for the model viewer.
				modelViewerActiveType: 'none', // Type of model actively selected ('m2', 'wmo', 'none').
				modelViewerGeosets: [], // Active M2 model geoset control.
				modelViewerSkins: [], // Active M2 model skins.
				modelViewerSkinsSelection: [], // Selected M2 model skins.
				modelViewerWMOGroups: [], // Active WMO model group control.
				modelViewerWMOSets: [], // Active WMO doodad set control.
				modelViewerAutoAdjust: true, // Automatic camera adjustment.
				textureRibbonStack: new Array<TextureRibbon.TextureRibbonSlot>, // Texture preview stack for model viewer.
				textureRibbonSlotCount: 0, // How many texture slots to render (dynamic).
				textureRibbonPage: 0, // Active page of texture slots to render.
				itemViewerTypeMask: [], // Active item type control.
				modelTexturePreviewWidth: 256, // Active width of the texture preview on the model viewer.
				modelTexturePreviewHeight: 256, // Active height of the texture preview on the model viewer.
				modelTexturePreviewURL: '', // Active URL of the texture preview image on the model viewer.
				modelTexturePreviewName: '', // Name of the texture preview image on the model viewer.
				texturePreviewWidth: 256, // Active width of the texture preview.
				texturePreviewHeight: 256, // Active height of the texture preview.
				texturePreviewURL: '', // Active URL of the texture preview image.
				texturePreviewInfo: '', // Text information for a displayed texture.
				overrideModelList: [], // Override list of models.
				overrideModelName: '', // Override model name.
				overrideTextureList: [], // Override list of textures.
				overrideTextureName: '', // Override texture name.
				mapViewerMaps: [], // Available maps for the map viewer.
				mapViewerHasWorldModel: false, // Does selected map have a world model?
				mapViewerTileLoader: null, // Tile loader for active map viewer map.
				mapViewerSelectedMap: null, // Currently selected map.
				mapViewerSelectedDir: null,
				mapViewerChunkMask: null, // Map viewer chunk mask.
				mapViewerSelection: [], // Map viewer tile selection
				exportCancelled: false, // Export cancellation state.
				toastTimer: -1, // Timer ID for toast expiration.
				dropHandlers: Array<DropHandler>(), // Handlers for file drag/drops.
				loaders: Array<Promise<void>>, // Loading step promises.
				isXmas: (new Date().getMonth() === 11),
				regexTooltip: '(a|b) - Matches either a or b.\n[a-f] - Matches characters between a-f.\n[^a-d] - Matches characters that are not between a-d.\n\\s - Matches whitespace characters.\n\\d - Matches any digit.\na? - Matches zero or one of a.\na* - Matches zero or more of a.\na+ - Matches one or more of a.\na{3} - Matches exactly 3 of a.',
				contextMenus: {
					nodeTextureRibbon: null, // Context menu node for the texture ribbon.
					nodeItem: null, // Context menu node for the items listfile.
					stateNavExtra: false, // State controller for the extra nav menu.
					stateModelExport: false, // State controller for the model export menu.
				},
				menuButtonTextures: [
					{ label: 'Export as PNG', value: 'PNG' },
					{ label: 'Export as BLP (Raw)', value: 'BLP' },
					{ label: 'Copy to Clipboard', value: 'CLIPBOARD' }
				],
				menuButtonTextureQuality: [
					{ label: 'Alpha Maps', value: -1 },
					{ label: 'None', value: 0 },
					{ label: 'Minimap (512)', value: 512 },
					{ label: 'Low (1k)', value: 1024 },
					{ label: 'Medium (4k)', value: 4096 },
					{ label: 'High (8k)', value: 8192 },
					{ label: 'Ultra (16k)', value: 16384 }
				],
				menuButtonModels: [
					{ label: 'Export OBJ', value: 'OBJ' },
					//{ label: 'Export glTF', value: 'GLTF' },
					//{ label: 'Export glTF (Binary)', value: 'GLB' },
					{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
					{ label: 'Export PNG (3D Preview)', value: 'PNG' },
					{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
				]
			};
		},

		methods: {
			/**
			 * Hide the currently active toast prompt.
			 * @param userCancel - If true, toast was cancelled by the user.
			 */
			hideToast: function(userCancel = false) {
				// Cancel outstanding toast expiry timer.
				if (this.toastTimer > -1) {
					clearTimeout(this.toastTimer);
					this.toastTimer = -1;
				}

				this.toast = null;

				if (userCancel)
					Events.emit('toast-cancelled');
			},

			/**
			 * Display a toast message.
			 * @param toastType - Type of toast to display.
			 * @param message - Message to display.
			 * @param options - Options to pass to the toast.
			 * @param ttl - Time in milliseconds before removing the toast.
			 * @param closable - If true, toast can manually be closed.
			 */
			setToast: function(toastType: ToastType, message: string, options: object | null = null, ttl = 10000, closable = true) {
				this.toast = { type: toastType, message, options, closable };

				// Remove any outstanding toast timer we may have.
				clearTimeout(this.toastTimer);

				// Create a timer to remove this toast.
				if (ttl > -1)
					this.toastTimer = setTimeout(() => this.hideToast(), ttl);
			},

			/**
			 * Open user-configured export directory with OS default.
			 */
			openExportDirectory: function() {
				nw.Shell.openItem(this.config.exportDirectory);
			},

			/**
			 * Register a function to be invoked when the user drops a file onto the application.
			 * @param handler - Handler to register.
			 */
			registerDropHandler: function(handler: DropHandler) {
				// Ensure the extensions are all lower-case.
				handler.ext = handler.ext.map(e => e.toLowerCase());
				this.dropHandlers.push(handler);
			},

			/**
			 * Get a drop handler for the given file path.
			 * @param file - File path to get handler for.
			 * @returns Drop handler, or null if none found.
			 */
			getDropHandler: function (file: string): DropHandler | null {
				file = file.toLowerCase();

				for (const handler of this.dropHandlers) {
					for (const ext of handler.ext) {
						if (file.endsWith(ext))
							return handler;
					}
				}

				return null;
			},

			/**
			 * Register a promise to be resolved during the last loading step.
			 * @param func - Promise to resolve.
			 */
			registerLoadFunc: function(func: Promise<void>) {
				this.loaders.push(func);
			},

			/**
			 * Resolves all registered load functions.
			 * @returns Promise that resolves when all load functions have been resolved.
			 */
			resolveLoadFuncs: async function() {
				await Promise.all(this.loaders);
				this.loaders.length = 0;
			},

			/**
			 * Resolves an async function and blocks the UI until it's done.
			 * @param func - Function to execute.
			 */
			block: async function(func: () => Promise<void>) {
				this.isBusy++;
				await func();
				this.isBusy--;
			},

			/**
			 * Creates a progress object for the given number of segments.
			 * @param segments - Number of segments to split the progress into.
			 * @returns Progress object.
			 */
			createProgress: function(segments = 1): ProgressObject {
				this.loadPct = 0;

				return {
					segWeight: 1 / segments,
					value: 0,
					step: async function(text?: string): Promise<void> {
						this.value++;
						State.state.loadPct = Math.min(this.value * this.segWeight, 1);

						if (text)
							State.state.loadingProgress = text;

						await redraw();
					}
				};
			},

			/**
			 * Invoked when the user chooses to manually install the Blender add-on.
			 */
			openBlenderAddonFolder: function() {
				Blender.openAddonDirectory();
			},

			/**
			 * Invoked when the user chooses to automatically install the Blender add-on.
			 */
			installBlenderAddon: function() {
				Blender.startAutomaticInstall();
			},

			/**
			 * Opens the runtime application log from the application data directory.
			 */
			openRuntimeLog() {
				Log.openRuntimeLog();
			},

			/**
			 * Reloads all stylesheets in the document.
			 */
			reloadStylesheet() {
				const sheets = document.querySelectorAll('link[rel="stylesheet"]');
				for (const sheet of sheets as NodeListOf<HTMLLinkElement>)
					sheet.href = sheet.getAttribute('data-href') + '?v=' + Date.now();
			},

			/**
			 * Mark all WMO groups to the given state.
			 * @param state
			 */
			setAllWMOGroups: function(state: boolean) {
				if (this.modelViewerWMOGroups) {
					for (const node of this.modelViewerWMOGroups)
						node.checked = state;
				}
			},

			/**
			 * Mark all geosets to the given state.
			 * @param state
			 */
			setAllGeosets: function(state: boolean) {
				if (this.modelViewerGeosets) {
					for (const node of this.modelViewerGeosets)
						node.checked = state;
				}
			},

			/**
			 * Mark all item types to the given state.
			 * @param state
			 */
			setAllItemTypes: function(state: boolean) {
				for (const entry of this.itemViewerTypeMask)
					entry.checked = state;
			},

			/**
			 * Return a tag for a given product.
			 * @param product
			 */
			getProductTag: function(product: string) {
				const entry = Constants.PRODUCTS.find(e => e.product === product);
				return entry ? entry.tag : 'Unknown';
			},

			/**
			 * Set the currently active screen.
			 * If `preserve` is true, the current screen ID will be pushed further onto the stack.
			 * showPreviousScreen() can be used to return to it. If false, overwrites screenStack[0].
			 * @param screenID
			 * @param preserve
			 */
			setScreen: function(screenID: string, preserve = false) {
				this.loadPct = -1; // Ensure we reset if coming from a loading screen.

				// Ensure that all context menus are absorbed by screen changes.
				const contextMenus = this.contextMenus;
				for (const [key, value] of Object.entries(contextMenus)) {
					if (value === true)
						contextMenus[key] = false;
					else if (value !== false)
						contextMenus[key] = null;
				}

				if (preserve) {
					if (this.screenStack[0] !== screenID)
						this.screenStack.unshift(screenID);
				} else {
					this.screenStack.splice(0, this.screenStack.length, screenID);
				}
			},

			/**
			 * Show the loading screen with a given message.
			 * @param text Defaults to 'Loading, please wait'
			 */
			showLoadScreen: function(text: string) {
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
			 * @param tag
			 */
			handleToastOptionClick: function(func: () => void) {
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
			 * @param region
			 */
			setSelectedCDN: function(region: CDNRegion) {
				this.selectedCDNRegion = region;
				this.lockCDNRegion = true;
				this.config.sourceSelectUserRegion = region.tag;
			},

			/**
			 * Emit an event using the global event emitter.
			 * @param tag
			 * @param event
			 */
			click: function(tag: string, event: MouseEvent, ...params) {
				const target = event.target as HTMLElement;
				if (!target.classList.contains('disabled'))
					Events.emit('click-' + tag, ...params);
			},

			/**
			 * Pass-through function to emit events from reactive markup.
			 * @param tag
			 * @param params
			 */
			emit: function(tag: string | symbol, ...params) {
				Events.emit(tag, ...params);
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
			 * @param width - The new width of the ribbon.
			 */
			onTextureRibbonResize: function(width: number) {
				TextureRibbon.onResize(width);
			},

			/**
			 * Switches to the textures tab and filters for the given file.
			 * @param fileDataID
			 */
			goToTexture: function(fileDataID: number) {
				this.setScreen('tab-textures');

				// Directly preview the requested file, even if it's not in the listfile.
				previewTextureByID(fileDataID);

				// Since we're doing a direct preview, we need to reset the users current
				// selection, so if they hit export, they get the expected result.
				this.selectionTextures.splice(0);

				// Despite direct preview, *attempt* to filter for the file as well.
				if (this.config.listfileShowFileDataIDs) {
					// If the user has fileDataIDs shown, filter by that.
					if (this.config.regexFilters)
						this.userInputFilterTextures = '\\[' + fileDataID + '\\]';
					else
						this.userInputFilterTextures = '[' + fileDataID + ']';
				} else {
					// Without fileDataIDs, lookup the texture name and filter by that.
					const fileName = Listfile.getByID(fileDataID);
					if (fileName !== undefined)
						this.userInputFilterTextures = fileName;
					else if (this.config.enableUnknownFiles)
						this.userInputFilterTextures = Listfile.formatUnknownFile(fileDataID, '.blp');
				}
			},

			/**
				 * Copy given data as text to the system clipboard.
				 * @param data
				 */
			copyToClipboard: function(data: string) {
				nw.Clipboard.get().set(data.toString(), 'text');
			},

			/**
			 * Get the external export path for a given file.
			 * @param file
			 * @returns
			 */
			getExportPath: function(file: string): string {
				return ExportHelper.getExportPath(file);
			},

			/**
			 * Returns a reference to the external links module.
			 * @returns
			 */
			getExternalLink: function() {
				return ExternalLinks;
			},

			/**
			 * Invoked when the user selects the models button on an item.
			 * @param item
			 */
			viewModels: function(item: object) {
				viewItemModels(item);
			},

			/**
			 * Invoked when the user selects the textures button on an item.
			 * @param item
			 */
			viewTextures: function(item: object) {
				viewItemTextures(item);
			}
		},

		computed: {
			/**
			 * Returns true if the export directory contains spaces.
			 * @returns {boolean}
			 */
			isExportPathConcerning: function(): boolean {
				return !!this.config?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns true if the editing config directory contains spaces.
			 * @returns {boolean}
			 */
			isEditExportPathConcerning: function(): boolean {
				return !!this.configEdit?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns the location of the last export manifest.
			 * @returns {string}
			 */
			lastExportPath: function(): string {
				if (this.config.lastExportFile.length > 0)
					return this.config.lastExportFile;

				return Constants.LAST_EXPORT;
			},

			/**
			 * Returns the default location of the last export manifest.
			 * @returns Default location of the last export manifest
			 */
			lastExportPathDefault: function(): string {
				return Constants.LAST_EXPORT;
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
				return filesize(this.cacheSize);
			},

			/**
			 * Returns an Array of available locale keys.
			 */
			availableLocaleKeys: function() {
				const flags = new Map<string, number>;
				for (const [key, value] of Object.entries(LocaleFlags)) {
					if (Number(key) >= 0)
						continue;

					flags.set(key, Number(value));
				}

				return Array.from(flags.keys()).map(e => {
					return { label: e, value: flags.get(e) };
				});
			},

			/**
			 * Return the locale key for the configured CASC locale.
			 */
			selectedLocaleKey: function() {
				return this.config.cascLocale;
			},

			/**
			 * Return the formatted duration of the selected track on the sound player.
			 */
			soundPlayerDurationFormatted: function() {
				return formatPlaybackSeconds(this.soundPlayerDuration);
			},

			/**
			 * Return the formatted current seek of the selected track on the sound player.
			 */
			soundPlayerSeekFormatted: function() {
				return formatPlaybackSeconds(this.soundPlayerSeek * this.soundPlayerDuration);
			},

			/**
			 * Returns the maximum amount of pages needed for the texture ribbon.
			 * @returns {number}
			 */
			textureRibbonMaxPages: function(): number {
				return Math.ceil(this.textureRibbonStack.length / this.textureRibbonSlotCount);
			},

			/**
			 * Returns the texture ribbon stack array subject to paging.
			 * @returns {Array}
			 */
			textureRibbonDisplay: function(): Array<TextureRibbon.TextureRibbonSlot> {
				const startIndex = this.textureRibbonPage * this.textureRibbonSlotCount;
				return this.textureRibbonStack.slice(startIndex, startIndex + this.textureRibbonSlotCount);
			}
		},

		watch: {
			/**
			 * Invoked when the active 'screen' is changed.
			 * @param {string} val
			 */
			screen: function(val: string) {
				Events.emit('screen-' + val);
			},

			/**
			 * Invoked when the active loading percentage is changed.
			 * @param val
			 */
			loadPct: function(val: number) {
				nw.Window.get().setProgressBar(val);
			},

			/**
			 * Invoked when the core CASC instance is changed.
			 */
			casc: function() {
				Events.emit('casc-source-changed');
			}
		}
	});

	// Register error handler for Vue errors.
	app.config.errorHandler = CrashHandler.handleVueError;

	// Register components.
	app.component('checkboxlist', ComponentCheckboxList);
	app.component('context-menu', ComponentContextMenu);
	app.component('data-table', ComponentDataTable);
	app.component('file-field', ComponentFileField);
	app.component('itemlistbox', ComponentItemListBox);
	app.component('listbox', ComponentListBox);
	app.component('listboxb', ComponentListBoxB);
	app.component('map-viewer', ComponentMapViewer);
	app.component('menu-button', ComponentMenuButton);
	app.component('model-viewer', ComponentModelViewer);
	app.component('resize-layer', ComponentResizeLayer);
	app.component('slider', ComponentSlider);

	const state = defineComponent(app.mount('#container'));
	State.state = state;

	window['state'] = state;

	// Load configuration.
	await Config.load();

	// Emit state-ready event and await all listeners.
	await Events.emitAndAwait('state-ready', state);

	// Set-up default export directory if none configured.
	if (State.state.config.exportDirectory === '') {
		State.state.config.exportDirectory = path.join(os.homedir(), 'wow.export');
		Log.write('No export directory set, setting to %s', State.state.config.exportDirectory);
	}

	// Set-up proper drag/drop handlers.
	let dropStack = 0;
	window.ondragenter = (e: DragEvent): boolean => {
		e.preventDefault();

		// Converting local files while busy shouldn't end badly, but it seems
		// weird to let people do this on loading screens.
		if (State.state.isBusy)
			return false;

		dropStack++;

		// We're already showing a prompt, don't re-process it.
		if (state.fileDropPrompt !== null)
			return false;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath: string = (files[0] as unknown as NWFile).path;
			const handler = state.getDropHandler(firstFilePath);

			if (handler) {
				let count = 0;
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some((ext: string) => check.endsWith(ext)))
						count++;
				}

				if (count > 0)
					state.fileDropPrompt = handler.prompt(count);
			} else {
				state.fileDropPrompt = 'That file cannot be converted.';
			}
		}

		return false;
	};

	window.ondrop = (e: DragEvent): boolean => {
		e.preventDefault();
		state.fileDropPrompt = null;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath = (files[0] as unknown as NWFile).path;
			const handler = state.getDropHandler(firstFilePath);

			if (handler) {
				// Since dataTransfer.files is a FileList, we need to iterate it the old fashioned way.
				const include = Array<string>();
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some((ext: string) => check.endsWith(ext))) {
						const filePath = (file as unknown as NWFile).path;
						include.push(filePath);
					}
				}

				if (include.length > 0)
					handler.process(include);
			}
		}
		return false;
	};

	window.ondragleave = (e: DragEvent): void => {
		e.preventDefault();

		// Window drag events trigger for all elements. Ensure that there is currently
		// nothing being dragged once the dropStack is empty.
		dropStack--;
		if (dropStack === 0)
			state.fileDropPrompt = null;
	};

	// Load cachesize, a file used to track the overall size of the cache directory
	// without having to calculate the real size before showing to users. Fast and reliable.
	fs.readFile(Constants.CACHE.SIZE, 'utf8').then(data => {
		state.cacheSize = Number(data) || 0;
	}).catch(() => {
		// File doesn't exist yet, don't error.
	}).finally(() => {
		let updateTimer: NodeJS.Timeout;

		// Create a watcher programmatically *after* assigning the initial value
		// to prevent a needless file write by triggering itself during init.
		watch(ref(state.cacheSize), function(nv: number) {
			// Clear any existing timer running.
			clearTimeout(updateTimer);

			// We buffer this call by SIZE_UPDATE_DELAY so that we're not writing
			// to the file constantly during heavy cache usage. Postponing until
			// next tick would not help due to async and potential IO/net delay.
			updateTimer = setTimeout(() => {
				fs.writeFile(Constants.CACHE.SIZE, nv.toString(), 'utf8');
			}, Constants.CACHE.SIZE_UPDATE_DELAY);
		});
	});

	// Load/update BLTE decryption keys.
	TactKeys.load();

	// Check for updates (without blocking).
	if (process.env.NODE_ENV !== 'development') {
		Updater.checkForUpdates().then(updateAvailable => {
			if (updateAvailable) {
				// Update is available, prompt to update. If user declines,
				// begin checking the local Blender add-on version.
				State.state.setToast('info', 'A new update is available. You should update, it\'s probably really cool!', {
					'Update Now': () => Updater.applyUpdate(),
					'Maybe Later': () => Blender.checkLocalVersion()
				}, -1, false);
			} else {
				// No update available, start checking Blender add-on.
				Blender.checkLocalVersion();
			}
		});
	} else {
		// Debug mode, go straight to Blender add-on check.
		Blender.checkLocalVersion();
	}

	// Load the changelog when the user opens the screen.
	Events.on('screen-changelog', () => {
		setImmediate(async () => {
			const element = document.getElementById('changelog-text');

			if (process.env.NODE_ENV !== 'development') {
				try {
					const text = await fs.readFile('./src/CHANGELOG.md', 'utf8');
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
	state.setScreen('source-select');
})();