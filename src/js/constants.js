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

	CACHE: {
		SIZE: path.join(DATA_PATH, 'casc', 'cachesize'), // Cache size.
		SIZE_UPDATE_DELAY: 5000, // Milliseconds to buffer cache size update writes.
		DIR_BUILDS: path.join(DATA_PATH, 'casc', 'builds'), // Build-specific cache directory.
		DIR_INDEXES: path.join(DATA_PATH, 'casc', 'indicies'), // Cache for archive indexes.
		DIR_DATA: path.join(DATA_PATH, 'casc', 'data'), // Cache for single data files.
		BUILD_MANIFEST: 'manifest.json', // Build-specific manifest file.
		BUILD_LISTFILE: 'listfile', // Build-specific listfile file.
		BUILD_ENCODING: 'encoding', // Build-specific encoding file.
		BUILD_ROOT: 'root', // Build-specific root file.
		TACT_KEYS: path.join(DATA_PATH, 'tact.json'), // Tact key cache.
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
		MANIFEST: '.build.info', // File that contains version information in local installs.
		DATA_DIR: 'Data'
	},

	TIME: {
		DAY: 86400000 // Milliseconds in a day.
	}
};