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

// loaders is an array of promises which need to be resolved as a 
// step in the loading process, allowing components to initialize.
let loaders = [];

// scrollPositions stores persistent scroll positions for listbox components
// keyed by persistScrollKey (e.g., "models", "textures", etc.)
const scrollPositions = {};

const makeNewView = () => {
	return {
		screenStack: [], // Controls the currently active interface screen.
		isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
		isDev: !BUILD_RELEASE, // True if in development environment.
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
		userInputFilterZones: '', // Value of the 'filter' field for zones.
		userInputFilterItems: '', // Value of the 'filter' field of items.
		userInputFilterDB2s: '', // Value of the 'filter' field of DBs.
		userInputFilterDataTable: '', // Value of the 'filter' field for data table rows.
		userInputFilterRaw: '', // Value of the 'filter' field for raw files.
		userInputFilterInstall: '', // Value of the 'filter' field for install files.
		selectionTextures: [], // Current user selection of texture files.
		selectionModels: [], // Current user selection of models.
		selectionSounds: [], // Current user selection of sounds.
		selectionVideos: [],  // Current user selection of videos.
		selectionText: [], // Current user selection of text files.
		selectionMaps: [], // Current user selection of maps.
		selectionZones: [], // Current user selection of zones.
		selectionItems: [], // Current user selection of items.
		selectionDB2s: [], // Current user selection of DB2s.
		selectionDataTable: [], // Current user selection of data table rows.
		selectionRaw: [], // Current user selection of raw files.
		selectionInstall: [], // Current user selection of install files.
		listfileTextures: [], // Filtered listfile for texture files.
		listfileSounds: [], // Filtered listfile for sound files.
		listfileVideos: [], // Filtered listfile for video files.
		listfileText: [], // Filtered listfile for text files.
		listfileModels: [], // Filtered listfile for M2/WMO models.
		listfileItems: [], // Filtered item entries.
		listfileRaw: [], // Full raw file listfile.
		listfileInstall: [], // Filtered listfile for install files.
		dbdManifest: [], // DB2 entires from DBD manifest.
		installTags: [], // Install manifest tags.
		tableBrowserHeaders: [], // DB2 headers
		tableBrowserRows: [], // DB2 rows
		availableLocale: Locale, // Available CASC locale.
		fileDropPrompt: null, // Prompt to display for file drag/drops.
		changelogText: '', // Markdown content for changelog.
		whatsNewHTML: '', // HTML content for What's New section.
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
		modelViewerAnims: [], // Available animations.
		modelViewerAnimSelection: null, // Selected M2 model animation (single).
		modelViewerWMOGroups: [], // Active WMO model group control.
		modelViewerWMOSets: [], // Active WMO doodad set control.
		modelViewerAutoAdjust: true, // Automatic camera adjustment.
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
		legacyModelViewerContext: null, // 3D context for the legacy model viewer.
		legacyModelViewerActiveType: 'none', // Type of legacy model actively selected ('m2', 'wmo', 'none').
		legacyModelViewerGeosets: [], // Active legacy M2 model geoset control.
		legacyModelViewerSkins: [], // Active legacy M2 model skins.
		legacyModelViewerSkinsSelection: [], // Selected legacy M2 model skins.
		legacyModelViewerAnims: [], // Available legacy animations.
		legacyModelViewerAnimSelection: null, // Selected legacy M2 model animation (single).
		legacyModelViewerWMOGroups: [], // Active legacy WMO model group control.
		legacyModelViewerWMOSets: [], // Active legacy WMO doodad set control.
		legacyModelViewerAutoAdjust: true, // Automatic camera adjustment for legacy models.
		legacyModelTexturePreviewWidth: 256, // Active width of the texture preview on the legacy model viewer.
		legacyModelTexturePreviewHeight: 256, // Active height of the texture preview on the legacy model viewer.
		legacyModelTexturePreviewURL: '', // Active URL of the texture preview image on the legacy model viewer.
		legacyModelTexturePreviewName: '', // Name of the texture preview image on the legacy model viewer.
		legacyModelTexturePreviewUVOverlay: '', // UV overlay data URL for legacy texture preview.
		legacyModelViewerUVLayers: [], // Available UV layers for the active legacy model.
		userInputFilterLegacyModels: '', // Value of the 'filter' field for legacy models.
		selectionLegacyModels: [], // Current user selection of legacy models.
		listfileLegacyModels: [], // Filtered listfile for legacy M2/WMO models.
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
		selectedZoneExpansionFilter: -1, // Currently selected zone expansion filter (-1 = show all)
		mapViewerHasWorldModel: false, // Does selected map have a world model?
		mapViewerTileLoader: null, // Tile loader for active map viewer map.
		mapViewerSelectedMap: null, // Currently selected map.
		mapViewerSelectedDir: null,
		mapViewerChunkMask: null, // Map viewer chunk mask.
		mapViewerSelection: [], // Map viewer tile selection
		selectedExpansionFilter: -1, // Currently selected expansion filter (-1 = show all)
		chrModelViewerContext: null, // 3D context for the character-specific model viewer.
		chrModelViewerAnims: [], // Available character animations.
		chrModelViewerAnimSelection: null, // Selected character animation.
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
		chrCustUnsupportedWarning: false, // Display warning for unsupported character customizations.
		chrModelLoading: false,
		chrShowGeosetControl: false, // Controls whether geoset control view is shown instead of customization.
		colorPickerOpenFor: null, // Currently open color picker option ID.
		colorPickerPosition: { x: 0, y: 0 }, // Color picker popup position.
		chrImportChrName: '', // Character import, character name input.
		chrImportRegions: [],
		chrImportSelectedRegion: '',
		chrImportRealms: [],
		chrImportSelectedRealm: null,
		chrImportLoadVisage: false, // Whether or not to load the visage model instead (Dracthyr/Worgen)
		chrImportChrModelID: 0, // Temporary storage for target character model ID.
		chrImportChoices: [], // Temporary storage for character import choices.
		chrImportWowheadURL: '', // Wowhead dressing room url
		characterImportMode: 'none', // Controls visibility of character import interface ('none', 'BNET', 'WHEAD')
		realmList: {}, // Contains all regions and realms once realmlist.load() has been called.
		exportCancelled: false, // Export cancellation state.
		isXmas: (new Date().getMonth() === 11),
		regexTooltip: '(a|b) - Matches either a or b.\n[a-f] - Matches characters between a-f.\n[^a-d] - Matches characters that are not between a-d.\n\\s - Matches whitespace characters.\n\\d - Matches any digit.\na? - Matches zero or one of a.\na* - Matches zero or more of a.\na+ - Matches one or more of a.\na{3} - Matches exactly 3 of a.',
		contextMenus: {
			nodeTextureRibbon: null, // Context menu node for the texture ribbon.
			nodeItem: null, // Context menu node for the items listfile.
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
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonCharacterExport: [
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
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
	const lastExportFilePath = core.view.lastExportPath;
	if (fs.existsSync(lastExportFilePath) === false)
		return null;

	const lastExportFileStat = fs.statSync(lastExportFilePath);

	if (lastExportFileStat.isDirectory()) {
		log.write('ERROR: Last export file has been configured as a directory instead of a file!');
		return null;
	}

	return new FileWriter(lastExportFilePath, 'utf8');
};

/**
 * Run an async function while preventing the user from starting others.
 * This is heavily used in UI to disable components during big tasks.
 * @param {function} func 
 */
const block = async (func) => {
	core.view.isBusy++;
	await func();
	core.view.isBusy--;
};

/**
 * Create a progress interface for easy status reporting.
 * @param {number} segments 
 * @returns {Progress}
 */
const createProgress = (segments = 1) => {
	core.view.loadPct = 0;
	return {
		segWeight: 1 / segments,
		value: 0,
		step: async function(text) {
			this.value++;
			core.view.loadPct = Math.min(this.value * this.segWeight, 1);

			if (text)
				core.view.loadingProgress = text;

			await generics.redraw();
		}
	};
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
 * Register a promise to be resolved during the last loading step.
 * @param {function} func 
 */
const registerLoadFunc = (func) => {
	loaders.push(func);
};

/**
 * Resolve all registered loader functions.
 */
const runLoadFuncs = async () => {
	while (loaders.length > 0)
		await loaders.shift()();
		
	loaders = undefined;
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
	block,
	createProgress,
	setToast,
	hideToast,	
	openExportDirectory,
	registerDropHandler,
	getDropHandler,
	registerLoadFunc,
	runLoadFuncs,
	openLastExportStream,
	saveScrollPosition,
	getScrollPosition
};

module.exports = core;