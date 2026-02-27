import { app } from '../views/main/rpc.js';
import * as platform from './platform.js';

let INSTALL_PATH = '';
let DATA_PATH = '';
let _initialized = false;

export async function init() {
	if (_initialized)
		return;

	const c = await app.get_constants();

	INSTALL_PATH = c.INSTALL_PATH ?? '';
	DATA_PATH = c.DATA_PATH ?? '';

	constants.INSTALL_PATH = INSTALL_PATH;
	constants.DATA_PATH = DATA_PATH;
	constants.RUNTIME_LOG = c.RUNTIME_LOG ?? '';
	constants.LAST_EXPORT = c.LAST_EXPORT ?? '';
	constants.SHADER_PATH = c.SHADER_PATH ?? '';
	constants.VERSION = platform.get_version();
	constants.USER_AGENT = 'wow.export (' + platform.get_version() + ')';

	constants.BLENDER.DIR = c.BLENDER_DIR ?? '';
	constants.BLENDER.LOCAL_DIR = c.BLENDER_LOCAL_DIR ?? '';

	constants.CACHE.DIR = c.CACHE_DIR ?? '';
	constants.CACHE.SIZE = c.CACHE_SIZE ?? '';
	constants.CACHE.INTEGRITY_FILE = c.CACHE_INTEGRITY_FILE ?? '';
	constants.CACHE.DIR_BUILDS = c.CACHE_DIR_BUILDS ?? '';
	constants.CACHE.DIR_INDEXES = c.CACHE_DIR_INDEXES ?? '';
	constants.CACHE.DIR_DATA = c.CACHE_DIR_DATA ?? '';
	constants.CACHE.DIR_DBD = c.CACHE_DIR_DBD ?? '';
	constants.CACHE.DIR_LISTFILE = c.CACHE_DIR_LISTFILE ?? '';
	constants.CACHE.TACT_KEYS = c.CACHE_TACT_KEYS ?? '';
	constants.CACHE.REALMLIST = c.CACHE_REALMLIST ?? '';

	constants.CONFIG.DEFAULT_PATH = c.CONFIG_DEFAULT_PATH ?? '';
	constants.CONFIG.USER_PATH = c.CONFIG_USER_PATH ?? '';

	_initialized = true;
}

const constants = {
	init,

	INSTALL_PATH: '',
	DATA_PATH: '',
	RUNTIME_LOG: '',
	LAST_EXPORT: '',
	MAX_RECENT_LOCAL: 3,

	SHADER_PATH: '',
	VERSION: '',

	LISTFILE_MODEL_FILTER: /(_\d\d\d_)|(_\d\d\d.wmo$)|(lod\d.wmo$)/,
	USER_AGENT: 'wow.export',

	BLENDER: {
		DIR: '',
		ADDON_DIR: 'scripts/addons/io_scene_wowobj',
		LOCAL_DIR: '',
		ADDON_ENTRY: '__init__.py',
		MIN_VER: 2.8
	},

	GAME: {
		MAP_SIZE: 64,
		MAP_SIZE_SQ: 4096,
		MAP_COORD_BASE: 51200 / 3,
		TILE_SIZE: (51200 / 3) / 32,
		MAP_OFFSET: 17066,
	},

	CACHE: {
		DIR: '',
		SIZE: '',
		INTEGRITY_FILE: '',
		SIZE_UPDATE_DELAY: 5000,
		DIR_BUILDS: '',
		DIR_INDEXES: '',
		DIR_DATA: '',
		DIR_DBD: '',
		DIR_LISTFILE: '',
		BUILD_MANIFEST: 'manifest.json',
		BUILD_LISTFILE: 'listfile',
		BUILD_ENCODING: 'encoding',
		BUILD_ROOT: 'root',
		LISTFILE_DATA: 'listfile.txt',
		TACT_KEYS: '',
		REALMLIST: '',
	},

	CONFIG: {
		DEFAULT_PATH: '',
		USER_PATH: ''
	},

	PRODUCTS: [
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
	],

	PATCH: {
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
	},

	BUILD: {
		MANIFEST: '.build.info',
		DATA_DIR: 'Data'
	},

	TIME: {
		DAY: 86400000
	},

	KINO: {
		API_URL: 'https://www.kruithne.net/wow.export/v2/get_video',
		POLL_INTERVAL: 20000
	},

	MAGIC: {
		M3DT: 0x5444334D,
		MD21: 0x3132444D,
		MD20: 0x3032444D
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
		{ match: 'M3DT', ext: '.m3' },
		{ match: 'SKIN', ext: '.skin' },
		{ match: '\x01\x00\x00\x00BIDA', ext: '.bone' },
		{ match: 'SYHP\x02\x00\x00\x00', ext: '.phys' },
		{ match: 'HSXG', ext: '.bls' },
		{ match: 'RVXT', ext: '.tex' },
		{ match: 'RIFF', ext: '.avi' },
		{ match: 'WDC3', ext: '.db2' },
		{ match: 'WDC4', ext: '.db2' }
	],

	NAV_BUTTON_ORDER: [
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
	],

	CONTEXT_MENU_ORDER: [
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
	],

	FONT_PREVIEW_QUOTES: [
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
	],

	EXPANSIONS: [
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
	]
};

export default constants;
