// This file defines constants used throughout the application.
const path = require('path');

const INSTALL_PATH = nw.App.startPath;
const DATA_PATH = nw.App.dataPath;
const UPDATER_EXT = { win32: '.exe', darwin: '.app' };

module.exports = {
	INSTALL_PATH, // Path to the application installation.
	DATA_PATH, // Path to the users data directory.
	RUNTIME_LOG: path.join(DATA_PATH, 'runtime.log'), // Path to the runtime log.
	MAX_RECENT_LOCAL: 3, // Maximum recent local installations to remember.

	LISTFILE: {
		CACHE_DIR: path.join(DATA_PATH, 'listfile'), // Path to listfile cache directory.
		CACHE_MANIFEST: path.join(DATA_PATH, 'listfile', 'manifest.json')
	},

	CONFIG:  {
		DEFAULT_PATH: path.join(INSTALL_PATH, 'src', 'default_config.jsonc'), // Path of default configuration file.
		USER_PATH: path.join(DATA_PATH, 'config.json') // Path of user-defined configuration file.
	},

	UPDATE: {
		URL: 'https://kruithne.net/wow.export/%s/', // Remote path to obtain updates from.
		MANIFEST: 'package.json', // Remote manifest file for update checking.
		DIRECTORY: path.join(INSTALL_PATH, '.update'), // Temporary directory for storing update data.
		HELPER: 'updater' + (UPDATER_EXT[process.platform] || '') // Path to update helper application.
	},

	// These are labelled as they appear in the Battle.net launcher.
	PRODUCTS: {
		'wow': 'World of Warcraft',
		'wowt': 'PTR: World of Warcraft',
		'wow_beta': 'Beta: World of Warcraft',
		'wow_classic': 'World of Warcraft Classic'
	},

	PATCH: {
		REGIONS: ['eu', 'us', 'kr', 'cn', 'tw'], // Valid CDN regions.
		DEFAULT_REGION: 'us', // Region which is selected by default.
		HOST: 'http://%s.patch.battle.net:1119/', // Blizzard patch server host.
		SERVER_CONFIG: '/cdns', // CDN config file on patch server.
		VERSION_CONFIG: '/versions' // Versions config file on patch server.
	},

	BUILD: {
		MANIFEST: '.build.info' // File that contains version information in local installs.
	},

	TIME: {
		DAY: 86400000 // Milliseconds in a day.
	}
};