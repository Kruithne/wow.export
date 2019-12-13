const EventEmitter = require('events');
const generics = require('./generics');
const Locale = require('./casc/locale-flags');

let toastTimer = -1; // Used by setToast() for TTL toast prompts.

// core.events is a global event handler used for dispatching
// events from any point in the system, to any other point.
const events = new EventEmitter();
events.setMaxListeners(666);

// dropHandlers contains handlers for drag/drop support.
// Each item is an object defining .ext, .prompt() and .process().
const dropHandlers = [];

// The `view` object is used as the data source for the main Vue instance.
// All properties within it will be reactive once the view has been initialized.
const view = {
	screenStack: [], // Controls the currently active interface screen.
	isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
	loadingProgress: '', // Sets the progress text for the loading screen.
	loadingTitle: '', // Sets the title text for the loading screen.
	loadPct: -1, // Controls active loading bar percentage.
	toast: null, // Controls the currently active toast bar.
	cdnRegions: [], // CDN region data.
	selectedCDNRegion: null, // Active CDN region.
	lockCDNRegion: false, // If true, do not programatically alter the selected CDN region.
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
	userInputFilterModels: '', // Value of the 'filter' field for models.
	userInputFilterMaps: '', // Value of the 'filter' field for maps.
	selectionTextures: [], // Current user selection of texture files.
	selectionModels: [], // Current user selection of models.
	selectionSounds: [], // Current user selection of sounds.
	selectionVideos: [],  // Current user selection of videos.
	selectionMaps: [], // Current user selection of maps.
	listfileTextures: [], // Filtered listfile for texture files.
	listfileSounds: [], // Filtered listfile for sound files.
	listfileVideos: [], // Filtered listfile for video files.
	listfileModels: [], // Filtered listfile for M2/WMO models.
	availableLocale: Locale, // Available CASC locale.
	fileDropPrompt: null, // Prompt to display for file drag/drops.
	soundPlayerSeek: 0, // Current seek of the sound player.
	soundPlayerState: false, // Playing state of the sound player.
	soundPlayerTitle: 'No File Selected', // Name of the currently playing sound track.
	soundPlayerDuration: 0, // Duration of the currently playing sound track.
	modelViewerContext: null, // 3D context for the model viewer.
	modelViewerActiveType: 'none', // Type of model actively selected ('m2', 'wmo', 'none').
	modelViewerGeosets: [], // Active M2 model geoset control.
	modelViewerWMOGroups: [], // Active WMO model group control.
	modelViewerWMOSets: [], // Active WMO doodad set control.
	texturePreviewWidth: 256, // Active width of the texture preview.
	texturePreviewHeight: 256, // Active height of the texture preview.
	texturePreviewURL: '', // Active URL of the texture preview image.
	mapViewerMaps: [], // Available maps for the map viewer.
	mapViewerTileLoader: null, // Tile loader for active map viewer map.
	mapViewerSelectedMap: null, // Currently selected map.
	mapViewerChunkMask: null, // Map viewer chunk mask.
	mapViewerSelection: [], // Map viewer tile selection
};

/**
 * Run an async function while preventing the user from starting others.
 * This is heavily used in UI to disable components during big tasks.
 * @param {function} func 
 */
const block = async (func) => {
	view.isBusy++;
	await func();
	view.isBusy--;
};

/**
 * Create a progress interface for easy status reporting.
 * @param {number} segments 
 * @returns {Progress}
 */
const createProgress = (segments = 1) => {
	view.loadPct = 0;
	return {
		segWeight: 1 / segments,
		value: 0,
		step: async function(text) {
			this.value++;
			view.loadPct = Math.min(this.value * this.segWeight, 1);

			if (text)
				view.loadingProgress = text;

			await generics.redraw();
		}
	};
};

/**
 * Hide the currently active toast prompt.
 */
const hideToast = () => {
	// Cancel outstanding toast expiry timer.
	if (toastTimer > -1) {
		clearTimeout(toastTimer);
		toastTimer = -1;
	}

	view.toast = null;
};

/**
 * Display a toast message.
 * @param {string} toastType 'error', 'info', 'success', 'progress'
 * @param {string} message 
 * @param {object} options
 * @param {number} ttl Time in millseconds before removing the toast.
 * @param {boolean} closable If true, toast can manually be closed.
 */
const setToast = (toastType, message, options = null, ttl = 10000, closable = true) => {
	view.toast = { type: toastType, message, options, closable };

	// Remove any outstanding toast timer we may have.
	if (toastTimer > -1)
		clearTimeout(toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		toastTimer = setTimeout(hideToast, ttl);
}

/**
 * Open user-configured export directory with OS default.
 */
const openExportDirectory = () => {
	nw.Shell.openItem(view.config.exportDirectory)
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

	for (const handler of dropHandlers)
		for (const ext of handler.ext)
			if (file.endsWith(ext))
				return handler;
	
	return null;
};

const core = { 
	events,
	view,
	block,
	createProgress,
	setToast,
	hideToast,	
	openExportDirectory,
	registerDropHandler,
	getDropHandler
};

module.exports = core;