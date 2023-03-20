/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { reactive, watch, computed } from 'vue';

import Events from './events';

import { redraw } from './generics';
import { setTrayProgress } from './system';

import ProgressObject from './progress-object';

import type { Config } from './config';

export const state = reactive({
	screenStack: [], // Controls the currently active interface screen.
	screen: computed(() => state.screenStack[0]), // Active screen.

	isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
	loadingProgress: '', // Sets the progress text for the loading screen.
	loadingTitle: '', // Sets the title text for the loading screen.
	loadPct: -1, // Controls active loading bar percentage.
	toast: null, // Controls the currently active toast bar.
	cdnRegions: [], // CDN region data.
	selectedCDNRegion: null, // Active CDN region.
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

	// TODO: All propeties below likely do not need to be in the reactive state.
	loaders: Array<Promise<void>>, // Loading step promises.
	isXmas: (new Date().getMonth() === 11),
	regexTooltip: '(a|b) - Matches either a or b.\n[a-f] - Matches characters between a-f.\n[^a-d] - Matches characters that are not between a-d.\n\\s - Matches whitespace characters.\n\\d - Matches any digit.\na? - Matches zero or one of a.\na* - Matches zero or more of a.\na+ - Matches one or more of a.\na{3} - Matches exactly 3 of a.',
	isDebugBuild: process.env.NODE_ENV === 'development', // True if in development environment.

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

// Update application tray progress when our internal loading progress changes.
watch(() => state.loadPct, setTrayProgress);

// Emit an event when the active screen changes.
watch(() => state.screen, (screen: string) => Events.emit('screen:' + screen));

/**
 * Hide the currently active toast prompt.
 * @param userCancel - If true, toast was cancelled by the user.
 */
export function hideToast(userCancel = false): void {
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
export function setToast(toastType: ToastType, message: string, options: object | null = null, ttl = 10000, closable = true): void {
	state.toast = { type: toastType, message, options, closable };

	// Remove any outstanding toast timer we may have.
	clearTimeout(state.toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		state.toastTimer = setTimeout(() => state.hideToast(), ttl);
}

/**
 * Creates a progress object for the given number of segments.
 * @param segments - Number of segments to split the progress into.
 * @returns Progress object.
 */
export function createProgress(segments = 1): ProgressObject {
	state.loadPct = 0;

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

/**
 * Set the currently active screen.
 * If `preserve` is true, the current screen ID will be pushed further onto the stack.
 * showPreviousScreen() can be used to return to it. If false, overwrites screenStack[0].
 * @param screenID
 * @param preserve
 */
export function setScreen(screenID: string, preserve = false): void {
	state.loadPct = -1; // Ensure we reset if coming from a loading screen.

	// Ensure that all context menus are absorbed by screen changes.
	const contextMenus = state.contextMenus;
	for (const [key, value] of Object.entries(contextMenus)) {
		if (value === true)
			contextMenus[key] = false;
		else if (value !== false)
			contextMenus[key] = null;
	}

	if (preserve) {
		if (state.screenStack[0] !== screenID)
			state.screenStack.unshift(screenID);
	} else {
		state.screenStack.splice(0, state.screenStack.length, screenID);
	}
}

/**
 * Show the loading screen with a given message.
 * @param text Defaults to 'Loading, please wait'
 */
export function showLoadScreen(text: string): void {
	setScreen('loading');
	state.loadingTitle = text || 'Loading, please wait...';
}

/**
 * Remove the active screen from the screen stack, effectively returning to the
 * 'previous' screen. Has no effect if there are no more screens in the stack.
 */
export function showPreviousScreen(): void {
	if (state.screenStack.length > 1)
		state.screenStack.shift();
}

/**
 * Emit an event using the global event emitter.
 * @param tag
 * @param event
 */
export function click(tag: string, event: MouseEvent, ...params): void {
	// TODO: This smells bad.
	const target = event.target as HTMLElement;
	if (!target.classList.contains('disabled'))
		Events.emit('click-' + tag, ...params);
}