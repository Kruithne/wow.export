const EventEmitter = require('events');

// core.events is a global event handler used for dispatching
// events from any point in the system, to any other point.
const events = new EventEmitter();
events.setMaxListeners(666);

// The `view` object is used as the data source for the main Vue instance.
// All properties within it will be reactive once the view has been initialized.
const view = {
    screen: null, // Controls the currently active interface screen.
    isBusy: 0, // To prevent race-conditions with multiple tasks, we adjust isBusy to indicate blocking states.
    loadingProgress: '', // Sets the progress text for the loading screen.
    loadingTitle: '', // Sets the title text for the loading screen.
    loadPct: -1, // Controls active loading bar percentage.
    toast: null, // Controls the currently active toast bar.
    cdnRegions: [], // CDN region data.
    selectedCDNRegion: null, // Active CDN region.
    lockCDNRegion: false, // If true, do not programatically alter the selected CDN region.
    config: {}, // Will contain default/user-set configuration. Use config module to operate.
    availableLocalBuilds: null, // Array containing local builds to display during source select.
    availableRemoteBuilds: null, // Array containing remote builds to display during source select.
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
const setLoadProgress = (text, pct = -1) => {
    view.loadingProgress = text;
    view.loadPct = pct;
};

/**
 * Show the loading screen with a given message.
 * @param {string} text Defaults to 'Loading, please wait'
 */
const showLoadScreen = (text) => {
    view.screen = 'loading';
    view.loadingTitle = text || 'Loading, please wait...';
};

/**
 * Set the currently active screen.
 * @param {string} screenID 
 */
const setScreen = (screenID) => {
    view.loadPct = -1; // Ensure we reset if coming from a loading screen.
    view.screen = screenID;
};

/**
 * Display a toast message.
 * @param {string} toastType 'error', 'info', 'success', 'progress'
 * @param {string} message 
 * @param {object} options
 */
const setToast = (toastType, message, options = null) => {
    view.toast = { type: toastType, message, options };
}

module.exports = { events, view, block, setLoadProgress, showLoadScreen, setScreen, setToast };