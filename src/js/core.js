const EventEmitter = require('events');
const generics = require('./generics');

let toastTimer = -1; // Used by setToast() for TTL toast prompts.

// core.events is a global event handler used for dispatching
// events from any point in the system, to any other point.
const events = new EventEmitter();
events.setMaxListeners(666);

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
 * Set the current loading message as well as a completion percentage
 * between 0 and 1 (-1 to disable) used in the system taskbar.
 * @param {string} text 
 * @param {float} pct 
 */
const setLoadingText = async (text) => {
	view.loadingProgress = text;
	await generics.redraw();
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
 */
const setToast = (toastType, message, options = null, ttl = -1) => {
	view.toast = { type: toastType, message, options };

	// Remove any outstanding toast timer we may have.
	if (toastTimer > -1)
		clearTimeout(toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		toastTimer = setTimeout(hideToast, ttl);
}


const core = { 
	events,
	view,
	block,
	setLoadingText,
	createProgress,
	setToast,
	hideToast
};

module.exports = core;