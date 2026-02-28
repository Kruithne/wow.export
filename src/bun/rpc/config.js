import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Updater } from 'electrobun/bun';
import * as core from '../lib/core.js';
import * as constants from '../lib/constants.js';
import * as mmap from '../lib/mmap.js';
import * as generics from '../lib/generics.js';
import * as log from '../lib/log.js';

let _config = null;
let _defaults = null;
let _config_path = null;
let _defaults_path = null;
let _rpc = null;

export function init_config(paths, rpc) {
	_config_path = paths.user_config;
	_defaults_path = paths.default_config;
	_rpc = rpc;
}

export function get_config_ref() {
	return _config;
}

async function load_json(file_path, strip_comments = false) {
	try {
		let text = await fsp.readFile(file_path, 'utf8');
		if (strip_comments)
			text = text.replace(/^\s*\/\/.*$/gm, '');

		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function save_config() {
	if (!_config || !_config_path)
		return;

	await fsp.writeFile(_config_path, JSON.stringify(_config, null, '\t'), 'utf8');
}

export const config_handlers = {
	async config_get() {
		if (_config)
			return _config;

		_defaults = await load_json(_defaults_path, true) ?? {};
		_config = { ..._defaults, ...(await load_json(_config_path) ?? {}) };
		return _config;
	},

	async config_set({ key, value }) {
		if (!_config)
			await config_handlers.config_get();

		_config[key] = value;
		await save_config();

		core.events.emit('config-changed', { key, value });

		// notify view of change
		_rpc?.send?.config_changed?.({ key, value });
	},

	async config_reset_key({ key }) {
		if (!_config || !_defaults)
			await config_handlers.config_get();

		_config[key] = _defaults[key];
		await save_config();
		_rpc?.send?.config_changed?.({ key, value: _config[key] });
	},

	async config_reset_all() {
		_defaults = await load_json(_defaults_path, true) ?? {};
		_config = { ..._defaults };
		await save_config();
	},

	async config_get_defaults() {
		if (!_defaults)
			_defaults = await load_json(_defaults_path, true) ?? {};

		return _defaults;
	},
};

export const app_handlers = {
	async app_get_info() {
		return {
			version: constants.VERSION,
			data_path: constants.DATA_PATH,
			home_dir: os.homedir(),
		};
	},

	async app_get_constants() {
		return {
			PRODUCTS: constants.PRODUCTS,
			PATCH: constants.PATCH,
			BUILD: constants.BUILD,
			GAME: constants.GAME,
			MAGIC: constants.MAGIC,
			FILE_IDENTIFIERS: constants.FILE_IDENTIFIERS,
			NAV_BUTTON_ORDER: constants.NAV_BUTTON_ORDER,
			CONTEXT_MENU_ORDER: constants.CONTEXT_MENU_ORDER,
			FONT_PREVIEW_QUOTES: constants.FONT_PREVIEW_QUOTES,
			EXPANSIONS: constants.EXPANSIONS,
			LISTFILE_MODEL_FILTER: constants.LISTFILE_MODEL_FILTER.toString(),
			TIME: constants.TIME,
			KINO: constants.KINO,
			MAX_RECENT_LOCAL: constants.MAX_RECENT_LOCAL,

			INSTALL_PATH: constants.INSTALL_PATH,
			DATA_PATH: constants.DATA_PATH,
			RUNTIME_LOG: constants.RUNTIME_LOG,
			LAST_EXPORT: constants.LAST_EXPORT,
			SHADER_PATH: constants.SHADER_PATH,

			BLENDER_DIR: constants.BLENDER.DIR,
			BLENDER_LOCAL_DIR: constants.BLENDER.LOCAL_DIR,

			CACHE_DIR: constants.CACHE.DIR,
			CACHE_SIZE: constants.CACHE.SIZE,
			CACHE_INTEGRITY_FILE: constants.CACHE.INTEGRITY_FILE,
			CACHE_DIR_BUILDS: constants.CACHE.DIR_BUILDS,
			CACHE_DIR_INDEXES: constants.CACHE.DIR_INDEXES,
			CACHE_DIR_DATA: constants.CACHE.DIR_DATA,
			CACHE_DIR_DBD: constants.CACHE.DIR_DBD,
			CACHE_DIR_LISTFILE: constants.CACHE.DIR_LISTFILE,
			CACHE_TACT_KEYS: constants.CACHE.TACT_KEYS,
			CACHE_REALMLIST: constants.CACHE.REALMLIST,

			CONFIG_DEFAULT_PATH: constants.CONFIG.DEFAULT_PATH,
			CONFIG_USER_PATH: constants.CONFIG.USER_PATH,
		};
	},

	async app_check_update() {
		const info = await Updater.checkForUpdate();
		return info;
	},

	async app_download_update() {
		Updater.onStatusChange((entry) => {
			_rpc?.send?.update_status?.({
				status: entry.status,
				progress: entry.details?.progress,
				error: entry.details?.errorMessage,
			});
		});

		try {
			await Updater.downloadUpdate();
			return { success: true };
		} catch (e) {
			return { success: false, error: e.message };
		} finally {
			Updater.onStatusChange(null);
		}
	},

	async app_apply_update() {
		await Updater.applyUpdate();
	},

	async app_get_cache_size() {
		return core.get_cache_size();
	},

	async app_clear_cache({ type }) {
		core.increment_busy();
		core.set_toast('progress', 'Clearing cache, please wait...', null, -1, false);
		log.write('Manual cache purge requested!');
		try {
			mmap.release_virtual_files();
			await fsp.rm(constants.CACHE.DIR, { recursive: true, force: true });
			await fsp.mkdir(constants.CACHE.DIR, { recursive: true });
			core.set_cache_size(0);
			log.write('Purge complete');
			core.set_toast('success', 'Cache has been successfully cleared, a restart is required.', null, -1, false);
			core.events.emit('cache-cleared');
		} catch (e) {
			log.write('Error clearing cache: %s', e.message);
			core.set_toast('error', 'Failed to clear cache: ' + e.message, null, -1, false);
		} finally {
			core.decrement_busy();
		}
	},
};
