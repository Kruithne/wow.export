/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// This file defines constants used throughout the application.
const path = require('path');

// Whether or not we're currently unit testing
const isUnitTest = typeof nw === 'undefined';

const INSTALL_PATH = isUnitTest ? process.cwd() : path.dirname(process.execPath);
const DATA_PATH = isUnitTest ? "./tests/user_data" : nw.App.dataPath;

const UPDATER_EXT = { win32: '.exe', darwin: '.app' };

module.exports = {
	INSTALL_PATH, // Path to the application installation.
	DATA_PATH, // Path to the users data directory.
	RUNTIME_LOG: path.join(DATA_PATH, 'runtime.log'), // Path to the runtime log.
	LAST_EXPORT: path.join(DATA_PATH, 'last_export'), // Location of the last export.
	MAX_RECENT_LOCAL: 3, // Maximum recent local installations to remember.

	// Location of GL shaders.
	SHADER_PATH: path.join(INSTALL_PATH, 'src', 'shaders'),

	// Current version of wow.export
	VERSION: isUnitTest ? "0.0.0" : nw.App.manifest.version,

	// Filter used to filter out WMO LOD files.
	LISTFILE_MODEL_FILTER: /(_\d\d\d_)|(_\d\d\d.wmo$)|(lod\d.wmo$)/,

	// User-agent used for HTTP/HTTPs requests.
	USER_AGENT: 'wow.export (' + (isUnitTest ? "0.0.0" : nw.App.manifest.version) + ')',

	// Defines Blender constants.
	BLENDER: {
		DIR: process.env.APPDATA + '\\Blender Foundation\\Blender', // Blender app-data directory.
		ADDON_DIR: 'scripts\\addons\\io_scene_wowobj', // Install path for add-ons
		LOCAL_DIR: path.join(INSTALL_PATH, 'addon', 'io_scene_wowobj'), // Local copy of our Blender add-on.
		ADDON_ENTRY: '__init__.py', // Add-on entry point that contains the version.
		MIN_VER: 2.8 // Minimum version supported by our add-on.
	},

	// Defines game-specific constants.
	GAME: {
		MAP_SIZE: 64,
		MAP_SIZE_SQ: 4096, // MAP_SIZE ^ 2
		MAP_COORD_BASE: 51200 / 3,
		TILE_SIZE: (51200 / 3) / 32,
		MAP_OFFSET: 17066,
	},

	CACHE: {
		DIR: path.join(DATA_PATH, 'casc'), // Cache directory.
		SIZE: path.join(DATA_PATH, 'casc', 'cachesize'), // Cache size.
		INTEGRITY_FILE: path.join(DATA_PATH, 'casc', 'cacheintegrity'), // Cache integrity file.
		SIZE_UPDATE_DELAY: 5000, // Milliseconds to buffer cache size update writes.
		DIR_BUILDS: path.join(DATA_PATH, 'casc', 'builds'), // Build-specific cache directory.
		DIR_INDEXES: path.join(DATA_PATH, 'casc', 'indices'), // Cache for archive indexes.
		DIR_DATA: path.join(DATA_PATH, 'casc', 'data'), // Cache for single data files.
		DIR_DBD: path.join(DATA_PATH, 'casc', 'dbd'), // Cache for DBD files.
		BUILD_MANIFEST: 'manifest.json', // Build-specific manifest file.
		BUILD_LISTFILE: 'listfile', // Build-specific listfile file.
		BUILD_ENCODING: 'encoding', // Build-specific encoding file.
		BUILD_ROOT: 'root', // Build-specific root file.
		TACT_KEYS: path.join(DATA_PATH, 'tact.json'), // Tact key cache.
		REALMLIST: path.join(DATA_PATH, 'realmlist.json'), // Realmlist cache.
	},

	CONFIG:  {
		DEFAULT_PATH: path.join(INSTALL_PATH, 'src', 'default_config.jsonc'), // Path of default configuration file.
		USER_PATH: path.join(DATA_PATH, 'config.json') // Path of user-defined configuration file.
	},

	UPDATE: {
		DIRECTORY: path.join(INSTALL_PATH, '.update'), // Temporary directory for storing update data.
		HELPER: 'updater' + (UPDATER_EXT[process.platform] || '') // Path to update helper application.
	},

	// product: Internal product ID.
	// title: Label as it appears on the Battle.net launcher.
	// tag: Specific version tag.
	PRODUCTS: [
		{ product: 'wow', title: 'World of Warcraft', tag: 'Retail' },
		{ product: 'wowt', title: 'PTR: World of Warcraft', tag: 'PTR' },
		{ product: 'wowxptr', title: 'PTR 2: World of Warcraft', tag: 'PTR 2'},
		{ product: 'wow_beta', title: 'Beta: World of Warcraft', tag: 'Beta' },
		{ product: 'wow_classic', title: 'World of Warcraft Classic', tag: 'Classic' },
		{ product: 'wow_classic_beta', title: 'Beta: World of Warcraft Classic', tag: 'Classic Beta' },
		{ product: 'wow_classic_ptr', title: 'PTR: World of Warcraft Classic', tag: 'Classic PTR' },
		{ product: 'wow_classic_era', title: 'World of Warcraft Classic Era', tag: 'Classic Era' },
		{ product: 'wow_classic_era_ptr', title: 'PTR: World of Warcraft Classic Era', tag: 'Classic Era PTR' }
	],

	PATCH: {
		REGIONS: ['eu', 'us', 'kr', 'tw', 'cn'], // Valid CDN regions.
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
	},

	MAGIC: {
		MD21: 0x3132444D, // M2 model magic.
		MD20: 0x3032444D // M2 model magic (legacy)
	},

	FILE_IDENTIFIERS: [
		{ match: 'OggS', ext: '.ogg' },
		{ match: ['ID3', '\xFF\xFB', '\xFF\xF3', '\xFF\xF2'], ext: '.mp3' },
		{ match: 'AFM2', ext: '.anim' },
		{ match: 'AFSA', ext: '.anim' },
		{ match: 'AFSB', ext: '.anim' },
		{ match: 'BLP2', ext: '.blp' },
		{ match: 'MD20', ext: '.m2' },
		{ match: 'MD21', ext: '.m2' },
		{ match: 'SKIN', ext: '.skin' },
		{ match: '\x01\x00\x00\x00BIDA', ext: '.bone' },
		{ match: 'SYHP\x02\x00\x00\x00', ext: '.phys' },
		{ match: 'HSXG', ext: '.bls' },
		{ match: 'RVXT', ext: '.tex' },
		{ match: 'RIFF', ext: '.avi' },
		{ match: 'WDC3', ext: '.db2' },
		{ match: 'WDC4', ext: '.db2' }
	]
};