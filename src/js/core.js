const EventEmitter = require('events');

const eventHandler = new EventEmitter();
eventHandler.setMaxListeners(666);

module.exports = {
    // core.events is a global event handler used for dispatching
    // events from any point in the system, to any other point.
    events: eventHandler,

    // The `view` object below is used as the data source for the main Vue instance.
    // All properties within it will be reactive once the view has been initialized.
    view: {
        screen: null, // Controls the currently active interface screen.
        isBusy: false, // Indicates a large task is currently active.
        isUpdating: false, // Controls the display of the update splash.
        updateProgress: '', // Sets the progress text displayed on the update splash.
        localSourceRecent: [
            "C:\\Program Files (x86)\\World of Warcraft",
            "C:\\Users\\Marlamin\\Games\\World of Warcraft"
        ], // Contains the latest local install paths used.
        toast: null, // Controls the currently active toast bar.
        cdnRegions: [], // CDN region data.
        selectedCDNRegion: null, // Active CDN region.
        lockCDNRegion: false, // If true, do not programatically alter the selected CDN region.
        config: {}, // Will contain default/user-set configuration. Use config module to operate.
    }
}