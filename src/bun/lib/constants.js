import path from 'node:path';
import os from 'node:os';

export let INSTALL_PATH = '';
export let DATA_PATH = '';
export let VERSION = '0.0.0';
export let USER_AGENT = 'wow.export';
export let RUNTIME_LOG = '';
export let LAST_EXPORT = '';
export let SHADER_PATH = '';
export let MAX_RECENT_LOCAL = 3;

export const LISTFILE_MODEL_FILTER = /(_\d\d\d_)|(_\d\d\d.wmo$)|(lod\d.wmo$)/;

export let CACHE = {};
export let CONFIG = {};
export let UPDATE = {};
export let BLENDER = {};

export const PRODUCTS = [
	{ product: 'wow', title: 'World of Warcraft', tag: 'Retail' },
	{ product: 'wowt', title: 'PTR: World of Warcraft', tag: 'PTR' },
	{ product: 'wowxptr', title: 'PTR 2: World of Warcraft', tag: 'PTR 2' },
	{ product: 'wow_beta', title: 'Beta: World of Warcraft', tag: 'Beta' },
	{ product: 'wow_classic', title: 'World of Warcraft Classic', tag: 'Classic' },
	{ product: 'wow_classic_beta', title: 'Beta: World of Warcraft Classic', tag: 'Classic Beta' },
	{ product: 'wow_classic_ptr', title: 'PTR: World of Warcraft Classic', tag: 'Classic PTR' },
	{ product: 'wow_classic_era', title: 'World of Warcraft Classic Era', tag: 'Classic Era' },
	{ product: 'wow_classic_era_ptr', title: 'PTR: World of Warcraft Classic Era', tag: 'Classic Era PTR' },
	{ product: 'wow_classic_titan', title: 'World of Warcraft Classic Titan Reforged', tag: 'Classic Titan' },
	{ product: 'wow_anniversary', title: 'World of Warcraft Classic Anniversary', tag: 'Classic Anniversary' }
];

export const PATCH = {
	REGIONS: [
		{ tag: 'eu', name: 'Europe' },
		{ tag: 'us', name: 'Americas' },
		{ tag: 'kr', name: 'Korea' },
		{ tag: 'tw', name: 'Taiwan' },
		{ tag: 'cn', name: 'China' }
	],
	DEFAULT_REGION: 'us',
	HOST: 'https://%s.version.battle.net/',
	HOST_CHINA: 'https://cn.version.battlenet.com.cn/',
	SERVER_CONFIG: '/cdns',
	VERSION_CONFIG: '/versions'
};

export const BUILD = {
	MANIFEST: '.build.info',
	DATA_DIR: 'Data'
};

export const GAME = {
	MAP_SIZE: 64,
	MAP_SIZE_SQ: 4096,
	MAP_COORD_BASE: 51200 / 3,
	TILE_SIZE: (51200 / 3) / 32,
	MAP_OFFSET: 17066,
};

export const TIME = {
	DAY: 86400000
};

export const KINO = {
	API_URL: 'https://www.kruithne.net/wow.export/v2/get_video',
	POLL_INTERVAL: 20000
};

export const MAGIC = {
	M3DT: 0x5444334D,
	MD21: 0x3132444D,
	MD20: 0x3032444D
};

export const FILE_IDENTIFIERS = [
	{ match: 'OggS', ext: '.ogg' },
	{ match: ['ID3', '\xFF\xFB', '\xFF\xF3', '\xFF\xF2'], ext: '.mp3' },
	{ match: 'AFM2', ext: '.anim' },
	{ match: 'AFSA', ext: '.anim' },
	{ match: 'AFSB', ext: '.anim' },
	{ match: 'BLP2', ext: '.blp' },
	{ match: 'MD20', ext: '.m2' },
	{ match: 'MD21', ext: '.m2' },
	{ match: 'M3DT', ext: '.m3' },
	{ match: 'SKIN', ext: '.skin' },
	{ match: '\x01\x00\x00\x00BIDA', ext: '.bone' },
	{ match: 'SYHP\x02\x00\x00\x00', ext: '.phys' },
	{ match: 'HSXG', ext: '.bls' },
	{ match: 'RVXT', ext: '.tex' },
	{ match: 'RIFF', ext: '.avi' },
	{ match: 'WDC3', ext: '.db2' },
	{ match: 'WDC4', ext: '.db2' }
];

export const NAV_BUTTON_ORDER = [
	'tab_models',
	'tab_textures',
	'tab_characters',
	'tab_items',
	'tab_item_sets',
	'tab_decor',
	'tab_creatures',
	'tab_audio',
	'tab_videos',
	'tab_maps',
	'tab_zones',
	'tab_text',
	'tab_fonts',
	'tab_data',
	'tab_models_legacy',
	'legacy_tab_textures',
	'legacy_tab_audio',
	'legacy_tab_fonts',
	'legacy_tab_data',
	'legacy_tab_files'
];

export const CONTEXT_MENU_ORDER = [
	'tab_blender',
	'tab_changelog',
	'runtime-log',
	'tab_raw',
	'tab_install',
	'settings',
	'restart',
	'reload-shaders',
	'reload-style',
	'reload-active',
	'reload-all',
	'tab_help'
];

export const FONT_PREVIEW_QUOTES = [
	'You take no candle!',
	'Keep your feet on the ground.',
	'Me not that kind of orc!',
	'Time is money, friend.',
	'Something need doing?',
	'For the Horde!',
	'For the Alliance!',
	'Light be with you.',
	'Stay away from da voodoo.',
	'My magic will tear you apart!',
	'All I ever wanted to do was study!',
	'Put your faith in the light...',
	'Storm, earth, and fire! Heed my call!',
	'Avast ye swabs, repel the invaders!'
];

export const EXPANSIONS = [
	{ id: 0, name: 'Classic', shortName: 'Classic' },
	{ id: 1, name: 'The Burning Crusade', shortName: 'TBC' },
	{ id: 2, name: 'Wrath of the Lich King', shortName: 'WotLK' },
	{ id: 3, name: 'Cataclysm', shortName: 'Cataclysm' },
	{ id: 4, name: 'Mists of Pandaria', shortName: 'MoP' },
	{ id: 5, name: 'Warlords of Draenor', shortName: 'WoD' },
	{ id: 6, name: 'Legion', shortName: 'Legion' },
	{ id: 7, name: 'Battle for Azeroth', shortName: 'BfA' },
	{ id: 8, name: 'Shadowlands', shortName: 'SL' },
	{ id: 9, name: 'Dragonflight', shortName: 'DF' },
	{ id: 10, name: 'The War Within', shortName: 'TWW' },
	{ id: 11, name: 'Midnight', shortName: 'Midnight' },
	{ id: 12, name: 'The Last Titan', shortName: 'TLT' }
];

export const init = (app_paths) => {
	DATA_PATH = app_paths.data;
	INSTALL_PATH = app_paths.install || '';
	VERSION = app_paths.version || '0.0.0';
	USER_AGENT = 'wow.export (' + VERSION + ')';
	RUNTIME_LOG = app_paths.log || path.join(DATA_PATH, 'runtime.log');
	LAST_EXPORT = path.join(DATA_PATH, 'last_export');
	SHADER_PATH = INSTALL_PATH ? path.join(INSTALL_PATH, 'src', 'shaders') : '';

	const cache_dir = app_paths.cache || path.join(DATA_PATH, 'casc');
	CACHE = {
		DIR: cache_dir,
		SIZE: path.join(cache_dir, 'cachesize'),
		INTEGRITY_FILE: path.join(cache_dir, 'cacheintegrity'),
		SIZE_UPDATE_DELAY: 5000,
		DIR_BUILDS: path.join(cache_dir, 'builds'),
		DIR_INDEXES: path.join(cache_dir, 'indices'),
		DIR_DATA: path.join(cache_dir, 'data'),
		DIR_DBD: path.join(cache_dir, 'dbd'),
		DIR_LISTFILE: path.join(cache_dir, 'listfile'),
		BUILD_MANIFEST: 'manifest.json',
		BUILD_LISTFILE: 'listfile',
		BUILD_ENCODING: 'encoding',
		BUILD_ROOT: 'root',
		LISTFILE_DATA: 'listfile.txt',
		TACT_KEYS: path.join(DATA_PATH, 'tact.json'),
		REALMLIST: path.join(DATA_PATH, 'realmlist.json'),
	};

	CONFIG = {
		DEFAULT_PATH: app_paths.default_config || '',
		USER_PATH: app_paths.user_config || path.join(DATA_PATH, 'config.json'),
	};

	UPDATE = {
		DIRECTORY: INSTALL_PATH ? path.join(INSTALL_PATH, '.update') : '',
		HELPER: 'updater' + ({ win32: '.exe', darwin: '.app' }[process.platform] || ''),
	};

	const get_blender_base_dir = () => {
		const home_dir = os.homedir();
		switch (process.platform) {
			case 'win32':
				return path.join(process.env.APPDATA, 'Blender Foundation', 'Blender');
			case 'darwin':
				return path.join(home_dir, 'Library', 'Application Support', 'Blender');
			default:
				return path.join(home_dir, '.config', 'blender');
		}
	};

	BLENDER = {
		DIR: get_blender_base_dir(),
		ADDON_DIR: path.join('scripts', 'addons', 'io_scene_wowobj'),
		LOCAL_DIR: INSTALL_PATH ? path.join(INSTALL_PATH, 'addon', 'io_scene_wowobj') : '',
		ADDON_ENTRY: '__init__.py',
		MIN_VER: 2.8,
	};
};
