// This file defines constants used throughout the application.
const path = require('path');

const INSTALL_PATH = nw.App.startPath;
const DATA_PATH = nw.App.dataPath;
const UPDATER_EXT = { win32: '.exe', darwin: '.app' };

module.exports = {
    // General Constants
    INSTALL_PATH,
    DATA_PATH,
    RUNTIME_LOG: path.join(DATA_PATH, 'runtime.log'),

    // Application Updates
    UPDATE: {
        URL: 'https://kruithne.net/wow.export/%s/',
        MANIFEST: 'package.json',
        DIRECTORY: path.join(INSTALL_PATH, '.update'),
        HELPER: 'updater' + (UPDATER_EXT[process.platform] || '')
    },

    // Product Keys
    PRODUCT_KEYS: {
        WORLD_OF_WARCRAFT: 'wow',
        WORLD_OF_WARCRAFT_PTR: 'wowt',
        WORLD_OF_WARCRAFT_BETA: 'wow_beta',
    },

    // Blizzard Patch Server
    PATCH: {
        REGIONS: ['eu', 'us', 'kr', 'cn', 'tw'],
        DEFAULT_REGION: 'us',
        HOST: 'http://%s.patch.battle.net:1119',
        SERVER_CONFIG: 'cdns',
        VERSION_CONFIG: 'versions'
    }
};