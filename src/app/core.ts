/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { reactive } from 'vue';
import Events from './events';
import ExportHelper from './casc/export-helper';
import Listfile from './casc/listfile';
import { redraw } from './generics';

import ProgressObject from './progress-object';

import { previewTextureByID } from './ui/tab-textures';
import { viewItemModels, viewItemTextures } from './ui/tab-items';

import type { Config } from './config';

export const state = reactive({
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
	config: {} as Config, // Will contain default/user-set configuration. Use config module to operate.
	configEdit: {} as Config, // Temporary configuration clone used during user configuration editing.
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
	textureRibbonStack: [], // Texture preview stack for model viewer.
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
	dropHandlers: [], // Handlers for file drag/drops.
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
});

/**
 * Hide the currently active toast prompt.
 * @param userCancel - If true, toast was cancelled by the user.
 */
export function hideToast(userCancel = false) {
	// Cancel outstanding toast expiry timer.
	if (this.toastTimer > -1) {
		clearTimeout(this.toastTimer);
		this.toastTimer = -1;
	}

	this.toast = null;

	if (userCancel)
		Events.emit('toast-cancelled');
}

/**
 * Display a toast message.
 * @param toastType - Type of toast to display.
 * @param message - Message to display.
 * @param options - Options to pass to the toast.
 * @param ttl - Time in milliseconds before removing the toast.
 * @param closable - If true, toast can manually be closed.
 */
export function setToast(toastType: ToastType, message: string, options: object | null = null, ttl = 10000, closable = true) {
	this.toast = { type: toastType, message, options, closable };

	// Remove any outstanding toast timer we may have.
	clearTimeout(this.toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		this.toastTimer = setTimeout(() => this.hideToast(), ttl);
}

/** Open user-configured export directory with OS default. */
export function openExportDirectory() {
	nw.Shell.openItem(this.config.exportDirectory);
}

/**
 * Register a function to be invoked when the user drops a file onto the application.
 * @param handler - Handler to register.
 */
export function registerDropHandler(handler: DropHandler) {
	// Ensure the extensions are all lower-case.
	handler.ext = handler.ext.map(e => e.toLowerCase());
	this.dropHandlers.push(handler);
}

/**
 * Get a drop handler for the given file path.
 * @param file - File path to get handler for.
 * @returns Drop handler, or null if none found.
 */
export function getDropHandler(file: string): DropHandler | null {
	file = file.toLowerCase();

	for (const handler of this.dropHandlers) {
		for (const ext of handler.ext) {
			if (file.endsWith(ext))
				return handler;
		}
	}

	return null;
}

/**
 * Register a promise to be resolved during the last loading step.
 * @param func - Promise to resolve.
 */
export function registerLoadFunc(func: Promise<void>) {
	this.loaders.push(func);
}

/**
 * Resolves all registered load functions.
 * @returns Promise that resolves when all load functions have been resolved.
 */
export async function resolveLoadFuncs() {
	await Promise.all(this.loaders);
	this.loaders.length = 0;
}

/**
 * Resolves an async function and blocks the UI until it's done.
 * @param func - Function to execute.
 */
export async function block(func: () => Promise<void>) {
	this.isBusy++;
	await func();
	this.isBusy--;
}

/**
 * Creates a progress object for the given number of segments.
 * @param segments - Number of segments to split the progress into.
 * @returns Progress object.
 */
export function createProgress(segments = 1): ProgressObject {
	this.loadPct = 0;

	return {
		segWeight: 1 / segments,
		value: 0,
		step: async function(text?: string): Promise<void> {
			this.value++;
			state.loadPct = Math.min(this.value * this.segWeight, 1);

			if (text)
				state.loadingProgress = text;

			await redraw();
		}
	};
}

/** Invoked when the user chooses to manually install the Blender add-on. */
export function openBlenderAddonFolder() {
	Blender.openAddonDirectory();
}

/** Invoked when the user chooses to automatically install the Blender add-on. */
export function installBlenderAddon() {
	Blender.startAutomaticInstall();
}

/** Opens the runtime application log from the application data directory. */
export function openRuntimeLog() {
	Log.openRuntimeLog();
}

/** Reloads all stylesheets in the document. */
export function reloadStylesheet() {
	const sheets = document.querySelectorAll('link[rel="stylesheet"]');
	for (const sheet of sheets as NodeListOf<HTMLLinkElement>)
		sheet.href = sheet.getAttribute('data-href') + '?v=' + Date.now();
}

/**
 * Mark all WMO groups to the given state.
 * @param state
 */
export function setAllWMOGroups(state: boolean) {
	if (this.modelViewerWMOGroups) {
		for (const node of this.modelViewerWMOGroups)
			node.checked = state;
	}
}

/**
 * Mark all geosets to the given state.
 * @param state
 */
export function setAllGeosets(state: boolean) {
	if (this.modelViewerGeosets) {
		for (const node of this.modelViewerGeosets)
			node.checked = state;
	}
}

/**
 * Mark all item types to the given state.
 * @param state
 */
export function setAllItemTypes(state: boolean) {
	for (const entry of this.itemViewerTypeMask)
		entry.checked = state;
}

/**
 * Return a tag for a given product.
 * @param product
 */
export function getProductTag(product: string) {
	const entry = Constants.PRODUCTS.find(e => e.product === product);
	return entry ? entry.tag : 'Unknown';
}

/**
 * Set the currently active screen.
 * If `preserve` is true, the current screen ID will be pushed further onto the stack.
 * showPreviousScreen() can be used to return to it. If false, overwrites screenStack[0].
 * @param screenID
 * @param preserve
 */
export function setScreen(screenID: string, preserve = false) {
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
}

/**
 * Show the loading screen with a given message.
 * @param text Defaults to 'Loading, please wait'
 */
export function showLoadScreen(text: string) {
	this.setScreen('loading');
	this.loadingTitle = text || 'Loading, please wait...';
}

/**
 * Remove the active screen from the screen stack, effectively returning to the
 * 'previous' screen. Has no effect if there are no more screens in the stack.
 */
export function showPreviousScreen() {
	if (this.screenStack.length > 1)
		this.screenStack.shift();
}

/**
 * Invoked when a toast option is clicked.
 * The tag is passed to our global event emitter.
 * @param tag
 */
export function handleToastOptionClick(func: () => void) {
	this.toast = null;

	if (typeof func === 'function')
		func();
}

/** Invoked when a user cancels a model override filter. */
export function removeOverrideModels() {
	this.overrideModelList = [];
	this.overrideModelName = '';
}

/** Invoked when a user cancels a texture override filter. */
export function removeOverrideTextures() {
	this.overrideTextureList = [];
	this.overrideTextureName = '';
}

/**
 * Invoked when the user manually selects a CDN region.
 * @param region
 */
export function setSelectedCDN(region: CDNRegion) {
	this.selectedCDNRegion = region;
	this.lockCDNRegion = true;
	this.config.sourceSelectUserRegion = region.tag;
}

/**
 * Emit an event using the global event emitter.
 * @param tag
 * @param event
 */
export function click(tag: string, event: MouseEvent, ...params) {
	const target = event.target as HTMLElement;
	if (!target.classList.contains('disabled'))
		Events.emit('click-' + tag, ...params);
}

/**
 * Pass-through function to emit events from reactive markup.
 * @param tag
 * @param params
 */
export function emit(tag: string, ...params) {
	Events.emit(tag, ...params);
}

/** Restart the application. */
export function restartApplication() {
	chrome.runtime.reload();
}

/**
 * Invoked when the texture ribbon element on the model viewer
 * fires a resize event.
 * @param width - The new width of the ribbon.
 */
export function onTextureRibbonResize(width: number) {
	TextureRibbon.onResize(width);
}

/**
 * Switches to the textures tab and filters for the given file.
 * @param fileDataID
 */
export function goToTexture(fileDataID: number) {
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
}

/**
 * Copy given data as text to the system clipboard.
 * @param data
 */
export function copyToClipboard(data: string) {
	nw.Clipboard.get().set(data.toString(), 'text');
}

/**
 * Get the external export path for a given file.
 * @param file
 * @returns
 */
export function getExportPath(file: string): string {
	return ExportHelper.getExportPath(file);
}

/**
 * Returns a reference to the external links module.
 * @returns
 */
export function getExternalLink() {
	return ExternalLinks;
}

/**
 * Invoked when the user selects the models button on an item.
 * @param item
 */
export function viewModels(item: object) {
	viewItemModels(item);
}

/**
 * Invoked when the user selects the textures button on an item.
 * @param item
 */
export function viewTextures(item: object) {
	viewItemTextures(item);
}

export const fn = {
	hideToast,
	showToast,
	setProductState,
	getProductTag,
	setScreen,
	showLoadScreen,
	showPreviousScreen,
	handleToastOptionClick,
	removeOverrideModels,
	removeOverrideTextures,
	setSelectedCDN,
	click,
	emit,
	restartApplication,
	onTextureRibbonResize,
	goToTexture,
	copyToClipboard,
	getExportPath,
	getExternalLink,
	viewModels,
	viewTextures
};