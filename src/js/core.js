/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const EventEmitter = require('events');
const generics = require('./generics');
const Locale = require('./casc/locale-flags');
const constants = require('./constants');
const log = require('./log');
const fs = require('fs');
const FileWriter = require('./file-writer');

let toastTimer = -1; // Used by setToast() for TTL toast prompts.

// core.events is a global event handler used for dispatching
// events from any point in the system, to any other point.
const events = new EventEmitter();
events.setMaxListeners(666);

// dropHandlers contains handlers for drag/drop support.
// Each item is an object defining .ext, .prompt() and .process().
const dropHandlers = [];


// scrollPositions stores persistent scroll positions for listbox components
// keyed by persistScrollKey (e.g., "models", "textures", etc.)
const scrollPositions = {};

const makeNewView = () => {
	return {
		installType: 0, // Active install type (MPQ or CASC).
		isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
		isDev: !BUILD_RELEASE, // True if in development environment.
		isLoading: false, // Controls whether the loading overlay is visible.
		loadingProgress: '', // Sets the progress text for the loading screen.
		loadingTitle: '', // Sets the title text for the loading screen.
		loadPct: -1, // Controls active loading bar percentage.
		toast: null, // Controls the currently active toast bar.
		cdnRegions: [], // CDN region data.
		selectedCDNRegion: null, // Active CDN region.
		lockCDNRegion: false, // If true, do not programmatically alter the selected CDN region.
		config: {}, // Will contain default/user-set configuration. Use config module to operate.
		configEdit: {}, // Temporary configuration clone used during user configuration editing.
		constants: constants, // Application constants including expansion definitions.
		availableLocalBuilds: null, // Array containing local builds to display during source select.
		availableRemoteBuilds: null, // Array containing remote builds to display during source select.
		sourceSelectShowBuildSelect: false, // Controls whether build select is shown in source select module.
		casc: null, // Active CASC instance.
		cacheSize: 0, // Active size of the user cache.
		userInputTactKey: '', // Value of manual tact key field.
		userInputTactKeyName: '', // Value of manual tact key name field.
		userInputFilterTextures: '', // Value of the 'filter' field for textures.
		userInputFilterSounds: '', // Value of the 'filter' field for sounds/music.
		userInputFilterVideos: '', // Value of the 'filter' field for video files.
		userInputFilterText: '', // Value of the 'filter' field for text files.
		userInputFilterFonts: '', // Value of the 'filter' field for font files.
		userInputFilterModels: '', // Value of the 'filter' field for models.
		userInputFilterMaps: '', // Value of the 'filter' field for maps.
		userInputFilterZones: '', // Value of the 'filter' field for zones.
		userInputFilterItems: '', // Value of the 'filter' field of items.
		userInputFilterDB2s: '', // Value of the 'filter' field of DBs.
		userInputFilterDataTable: '', // Value of the 'filter' field for data table rows.
		userInputFilterRaw: '', // Value of the 'filter' field for raw files.
		activeModule: null, // Active module component instance.
		modNavButtons: [], // Module-registered navigation buttons.
		modContextMenuOptions: [], // Module-registered context menu options.
		userInputFilterInstall: '', // Value of the 'filter' field for install files.
		modelQuickFilters: ['m2', 'm3', 'wmo'], // Quick filter configuration for models tab.
		audioQuickFilters: ['ogg', 'mp3', 'unk'], // Quick filter configuration for audio tab.
		textQuickFilters: ['lua', 'xml', 'txt', 'sbt', 'wtf', 'htm', 'toc', 'xsd', 'srt'], // Quick filter configuration for text tab.
		selectionTextures: [], // Current user selection of texture files.
		selectionModels: [], // Current user selection of models.
		selectionSounds: [], // Current user selection of sounds.
		selectionVideos: [],  // Current user selection of videos.
		selectionText: [], // Current user selection of text files.
		selectionFonts: [], // Current user selection of font files.
		selectionMaps: [], // Current user selection of maps.
		selectionZones: [], // Current user selection of zones.
		selectionItems: [], // Current user selection of items.
		selectionDB2s: [], // Current user selection of DB2s.
		selectionDataTable: [], // Current user selection of data table rows.
		selectionRaw: [], // Current user selection of raw files.
		selectionInstall: [], // Current user selection of install files.
		installStringsView: false, // Whether to show strings view instead of manifest.
		installStrings: [], // Extracted strings from binary file.
		installStringsFileName: '', // Name of file strings were extracted from.
		selectionInstallStrings: [], // Current user selection of strings.
		userInputFilterInstallStrings: '', // Filter field for strings.
		listfileTextures: [], // Filtered listfile for texture files.
		listfileSounds: [], // Filtered listfile for sound files.
		listfileVideos: [], // Filtered listfile for video files.
		listfileText: [], // Filtered listfile for text files.
		listfileFonts: [], // Filtered listfile for font files.
		listfileModels: [], // Filtered listfile for M2/WMO models.
		listfileItems: [], // Filtered item entries.
		itemViewerTypeMask: [], // Item type filter mask.
		itemViewerQualityMask: [], // Item quality filter mask.
		listfileRaw: [], // Full raw file listfile.
		listfileInstall: [], // Filtered listfile for install files.
		dbdManifest: [], // DB2 entires from DBD manifest.
		installTags: [], // Install manifest tags.
		tableBrowserHeaders: [], // DB2 headers
		tableBrowserRows: [], // DB2 rows
		availableLocale: Locale, // Available CASC locale.
		fileDropPrompt: null, // Prompt to display for file drag/drops.
		whatsNewHTML: '', // HTML content for What's New section.
		textViewerSelectedText: '', // Active text for the text viewer.
		fontPreviewPlaceholder: '', // Placeholder text for font preview.
		fontPreviewText: '', // User input text for font preview.
		fontPreviewFontFamily: '', // CSS font family for font preview.
		soundPlayerSeek: 0, // Current seek of the sound player.
		soundPlayerState: false, // Playing state of the sound player.
		soundPlayerTitle: 'No File Selected', // Name of the currently playing sound track.
		soundPlayerDuration: 0, // Duration of the currently playing sound track.
		videoPlayerState: false, // Playing state of the video player.
		modelViewerContext: null, // 3D context for the model viewer.
		modelViewerActiveType: 'none', // Type of model actively selected ('m2', 'wmo', 'none').
		modelViewerGeosets: [], // Active M2 model geoset control.
		modelViewerSkins: [], // Active M2 model skins.
		modelViewerSkinsSelection: [], // Selected M2 model skins.
		modelViewerAnims: [], // Available animations.
		modelViewerAnimSelection: null, // Selected M2 model animation (single).
		modelViewerAnimPaused: false, // Animation playback paused state.
		modelViewerAnimFrame: 0, // Current animation frame.
		modelViewerAnimFrameCount: 0, // Total frames in current animation.
		modelViewerWMOGroups: [], // Active WMO model group control.
		modelViewerWMOSets: [], // Active WMO doodad set control.
		modelViewerAutoAdjust: true, // Automatic camera adjustment.
		modelViewerRotationSpeed: 0, // Model rotation speed (0 = no rotation).
		textureRibbonStack: [], // Texture preview stack for model viewer.
		textureRibbonSlotCount: 0, // How many texture slots to render (dynamic).
		textureRibbonPage: 0, // Active page of texture slots to render.
		textureAtlasOverlayRegions: [], // Texture atlas render regions.
		textureAtlasOverlayWidth: 0, // Width of the texture atlas overlay.
		textureAtlasOverlayHeight: 0, // Height of the texture atlas overlay.
		itemViewerTypeMask: [], // Active item type control.
		modelTexturePreviewWidth: 256, // Active width of the texture preview on the model viewer.
		modelTexturePreviewHeight: 256, // Active height of the texture preview on the model viewer.
		modelTexturePreviewURL: '', // Active URL of the texture preview image on the model viewer.
		modelTexturePreviewName: '', // Name of the texture preview image on the model viewer.
		modelTexturePreviewUVOverlay: '', // UV overlay data URL for texture preview.
		modelViewerUVLayers: [], // Available UV layers for the active model.
		texturePreviewWidth: 256, // Active width of the texture preview.
		texturePreviewHeight: 256, // Active height of the texture preview.
		texturePreviewURL: '', // Active URL of the texture preview image.
		texturePreviewInfo: '', // Text information for a displayed texture.
		overrideModelList: [], // Override list of models.
		overrideModelName: '', // Override model name.
		overrideTextureList: [], // Override list of textures.
		overrideTextureName: '', // Override texture name.
		mapViewerMaps: [], // Available maps for the map viewer.
		zoneViewerZones: [], // Available zones for the zone viewer.
		zonePhases: [], // Available phases for the selected zone.
		zonePhaseSelection: null, // Currently selected zone phase.
		selectedZoneExpansionFilter: -1, // Currently selected zone expansion filter (-1 = show all)
		mapViewerHasWorldModel: false, // Does selected map have a world model?
		mapViewerIsWMOMinimap: false, // Is the map viewer showing a WMO minimap?
		mapViewerTileLoader: null, // Tile loader for active map viewer map.
		mapViewerSelectedMap: null, // Currently selected map.
		mapViewerSelectedDir: null,
		mapViewerChunkMask: null, // Map viewer chunk mask.
		mapViewerGridSize: null, // Map viewer grid size (null = default 64).
		mapViewerSelection: [], // Map viewer tile selection
		selectedExpansionFilter: -1, // Currently selected expansion filter (-1 = show all)
		chrModelViewerContext: null, // 3D context for the character-specific model viewer.
		chrModelViewerAnims: [], // Available character animations.
		chrModelViewerAnimSelection: null, // Selected character animation.
		chrModelViewerAnimPaused: false, // Character animation playback paused state.
		chrModelViewerAnimFrame: 0, // Current character animation frame.
		chrModelViewerAnimFrameCount: 0, // Total frames in current character animation.
		chrCustRaces: [], // Available character races to select from
		chrCustRaceSelection: [], // Current race ID selected
		chrCustModels: [], // Available character customization models.
		chrCustModelSelection: [], // Selected character customization model.
		chrCustOptions: [], // Available character customization options.
		chrCustOptionSelection: [], // Selected character customization option.
		chrCustChoices: [], // Available character customization choices.
		chrCustChoiceSelection: [], // Selected character customization choice.
		chrCustActiveChoices: [], // Active character customization choices.
		chrCustGeosets: [], // Character customization model geoset control.
		chrCustTab: 'models', // Active tab for character customization.
		chrCustRightTab: 'geosets', // Active right tab for character customization.
		chrModelLoading: false,
		chrShowGeosetControl: false, // Controls whether geoset control view is shown instead of customization.
		chrExportMenu: 'export', // Active menu in character export section ('export', 'textures', 'settings').
		colorPickerOpenFor: null, // Currently open color picker option ID.
		colorPickerPosition: { x: 0, y: 0 }, // Color picker popup position.
		chrImportChrName: '', // Character import, character name input.
		chrImportRegions: [],
		chrImportSelectedRegion: '',
		chrImportRealms: [],
		chrImportSelectedRealm: null,
		chrImportLoadVisage: false, // Whether or not to load the visage model instead (Dracthyr/Worgen)
		chrImportClassicRealms: false, // Whether to use classic realms instead of retail
		chrImportChrModelID: 0, // Temporary storage for target character model ID.
		chrImportChoices: [], // Temporary storage for character import choices.
		chrImportWowheadURL: '', // Wowhead dressing room url
		characterImportMode: 'none', // Controls visibility of character import interface ('none', 'BNET', 'WHEAD')
		chrEquippedItems: {}, // Equipped items by slot name (e.g., { Head: item, Chest: item })
		chrEquipmentSlotContext: null, // Context menu node for equipment slot right-click
		realmList: {}, // Contains all regions and realms once realmlist.load() has been called.
		exportCancelled: false, // Export cancellation state.
		isXmas: (new Date().getMonth() === 11),
		chrCustBakedNPCTexture: null, // BLP texture for baked NPC skins (from textures tab)
		regexTooltip: '.* - Matches anything\n(a|b) - Matches either a or b.\n[a-f] - Matches characters between a-f.\n[^a-d] - Matches characters that are not between a-d.\n\\s - Matches whitespace characters.\n\\d - Matches any digit.\na? - Matches zero or one of a.\na* - Matches zero or more of a.\na+ - Matches one or more of a.\na{3} - Matches exactly 3 of a.',
		contextMenus: {
			nodeTextureRibbon: null, // Context menu node for the texture ribbon.
			nodeItem: null, // Context menu node for the items listfile.
			nodeDataTable: null, // Context menu node for the data table.
			nodeListbox: null, // Context menu node for generic listbox (textures, models, audio, etc.).
			nodeMap: null, // Context menu node for maps listbox.
			nodeZone: null, // Context menu node for zones listbox.
			stateNavExtra: false, // State controller for the extra nav menu.
			stateModelExport: false, // State controller for the model export menu.
			stateCDNRegion: false, // State controller for the CDN region selection menu.
		},
		menuButtonTextures: [
			{ label: 'Export as PNG', value: 'PNG' },
			{ label: 'Export as WebP', value: 'WEBP' },
			{ label: 'Export as BLP (Raw)', value: 'BLP' },
			{ label: 'Copy to Clipboard', value: 'CLIPBOARD' }
		],
		menuButtonMapExport: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export PNG', value: 'PNG' },
			{ label: 'Export Raw', value: 'RAW' },
			{ label: 'Export Heightmaps', value: 'HEIGHTMAPS' }
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
		menuButtonHeightmapResolution: [
			{ label: '64x64', value: 64 },
			{ label: '128x128', value: 128 },
			{ label: '512x512', value: 512 },
			{ label: '1024x1024 (1k)', value: 1024 },
			{ label: '2048x2048 (2k)', value: 2048 },
			{ label: '4096x4096 (4k)', value: 4096 },
			{ label: 'Custom', value: -1 }
		],
		menuButtonHeightmapBitDepth: [
			{ label: '8-bit Depth', value: 8 },
			{ label: '16-bit Depth', value: 16 },
			{ label: '32-bit Depth', value: 32 }
		],
		menuButtonModels: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export STL', value: 'STL' },
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonCharacterExport: [
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export OBJ (Posed)', value: 'OBJ' },
			{ label: 'Export STL (Posed)', value: 'STL' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonVideos: [
			{ label: 'Export MP4 (Video + Audio)', value: 'MP4' },
			{ label: 'Export AVI (Video Only)', value: 'AVI' },
			{ label: 'Export MP3 (Audio Only)', value: 'MP3' },
			{ label: 'Export Subtitles', value: 'SUBTITLES' }
		],
		menuButtonData: [
			{ label: 'Export as CSV', value: 'CSV' },
			{ label: 'Export as SQL', value: 'SQL' },
			{ label: 'Export DB2 (Raw)', value: 'DB2' }
		],
		helpArticles: [],
		helpFilteredArticles: [],
		helpSelectedArticle: null,
		helpSearchQuery: ''
	};
}

// The `view` object is used as a reference to the data for the main Vue instance.
const view = null;

/**
 * Open a stream to the last export file.
 * @returns FileWriter|null
 */
const openLastExportStream = () => {
	return new FileWriter(constants.LAST_EXPORT, 'utf8');
};

/**
 * Creates a disposable lock that increments isBusy on creation and
 * decrements on disposal. Use with the `using` keyword.
 * @returns {Disposable}
 */
const create_busy_lock = () => {
	core.view.isBusy++;
	return { [Symbol.dispose]: () => core.view.isBusy-- };
};

// internal progress state for loading screen api
let loading_progress_segments = 1;
let loading_progress_value = 0;

/**
 * show loading screen with specified number of progress steps.
 * @param {number} segments
 * @param {string} title
 */
const showLoadingScreen = (segments = 1, title = 'Loading, please wait...') => {
	loading_progress_segments = segments;
	loading_progress_value = 0;
	core.view.loadPct = 0;
	core.view.loadingTitle = title;
	core.view.isLoading = true;
	core.view.isBusy++;
};

/**
 * advance loading screen progress by one step.
 * @param {string} text
 */
const progressLoadingScreen = async (text) => {
	loading_progress_value++;
	core.view.loadPct = Math.min(loading_progress_value / loading_progress_segments, 1);

	if (text)
		core.view.loadingProgress = text;

	await generics.redraw();
};

/**
 * hide loading screen.
 */
const hideLoadingScreen = () => {
	core.view.loadPct = -1;
	core.view.isLoading = false;
	core.view.isBusy--;
};

/**
 * Hide the currently active toast prompt.
 * @param {boolean} userCancel
 */
const hideToast = (userCancel = false) => {
	// Cancel outstanding toast expiry timer.
	if (toastTimer > -1) {
		clearTimeout(toastTimer);
		toastTimer = -1;
	}

	core.view.toast = null;

	if (userCancel)
		events.emit('toast-cancelled');
};

/**
 * Display a toast message.
 * @param {string} toastType 'error', 'info', 'success', 'progress'
 * @param {string} message 
 * @param {object} options
 * @param {number} ttl Time in milliseconds before removing the toast.
 * @param {boolean} closable If true, toast can manually be closed.
 */
const setToast = (toastType, message, options = null, ttl = 10000, closable = true) => {
	core.view.toast = { type: toastType, message, options, closable };

	// Remove any outstanding toast timer we may have.
	clearTimeout(toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		toastTimer = setTimeout(hideToast, ttl);
}

/**
 * Open user-configured export directory with OS default.
 */
const openExportDirectory = () => {
	nw.Shell.openItem(core.view.config.exportDirectory)
};

/**
 * Register a handler for file drops.
 * @param {object} handler 
 */
const registerDropHandler = (handler) => {
	// Ensure the extensions are all lower-case.
	handler.ext = handler.ext.map(e => e.toLowerCase());
	dropHandlers.push(handler);
};

/**
 * Get a drop handler for the given file path.
 * @param {string} file 
 */
const getDropHandler = (file) => {
	file = file.toLowerCase();

	for (const handler of dropHandlers) {
		for (const ext of handler.ext) {
			if (file.endsWith(ext))
				return handler;
		}
	}
	
	return null;
};


/**
 * Save scroll position for a listbox with the given key.
 * @param {string} key - Unique identifier for the listbox
 * @param {number} scrollRel - Relative scroll position (0-1)
 * @param {number} scrollIndex - Current scroll index
 */
const saveScrollPosition = (key, scrollRel, scrollIndex) => {
	if (!key)
		return;
	
	scrollPositions[key] = {
		scrollRel: scrollRel || 0,
		scrollIndex: scrollIndex || 0,
		timestamp: Date.now()
	};
};

/**
 * Get saved scroll position for a listbox with the given key.
 * @param {string} key - Unique identifier for the listbox
 * @returns {object|null} - Saved scroll state or null if not found
 */
const getScrollPosition = (key) => {
	if (!key || !scrollPositions[key]) return null;
	
	return scrollPositions[key];
};

const core = {
	events,
	view,
	makeNewView,
	create_busy_lock,
	showLoadingScreen,
	progressLoadingScreen,
	hideLoadingScreen,
	setToast,
	hideToast,
	openExportDirectory,
	registerDropHandler,
	getDropHandler,
	openLastExportStream,
	saveScrollPosition,
	getScrollPosition
};

module.exports = core;