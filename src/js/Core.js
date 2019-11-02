const EventEmitter = require('events');

const eventHandler = new EventEmitter();
eventHandler.setMaxListeners(666);

module.exports = {
    events: eventHandler,
    view: { // This is turned into a Vue instance during runtime.
        isSourceActive: false, // Indicates if a source has been selected.
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
    }
}