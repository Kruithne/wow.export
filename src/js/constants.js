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

    // How many recent local installations should we remember?
    MAX_RECENT_LOCAL: 3,

    // Configuration Constants
    CONFIG:  {
        DEFAULT_PATH: path.join(INSTALL_PATH, 'src', 'default_config.jsonc'),
        USER_PATH: path.join(DATA_PATH, 'config.json')
    },

    // Application Updates
    UPDATE: {
        URL: 'https://kruithne.net/wow.export/%s/',
        MANIFEST: 'package.json',
        DIRECTORY: path.join(INSTALL_PATH, '.update'),
        HELPER: 'updater' + (UPDATER_EXT[process.platform] || '')
    },

    // Product Keys
    // These are labelled as they appear in the Battle.net launcher.
    PRODUCTS: {
        'wow': 'World of Warcraft',
        'wowt': 'PTR: World of Warcraft',
        'wow_beta': 'Beta: World of Warcraft',
        'wow_classic': 'World of Warcraft Classic'
    },

    // Blizzard Patch Server
    PATCH: {
        REGIONS: ['eu', 'us', 'kr', 'cn', 'tw'],
        DEFAULT_REGION: 'us',
        HOST: 'http://%s.patch.battle.net:1119/',
        SERVER_CONFIG: '/cdns',
        VERSION_CONFIG: '/versions'
    },

    // Local Builds
    BUILD: {
        MANIFEST: '.build.info'
    }
};