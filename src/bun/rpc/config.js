import fsp from 'node:fs/promises';
import path from 'node:path';

// TODO: wire to actual constants.js paths after migration
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
		// TODO: derive from electrobun BuildConfig + package.json
		return {
			version: '0.2.14',
			flavour: 'win-x64',
			guid: '',
			data_path: '',
		};
	},

	async app_get_constants() {
		// TODO: migrate constants.js
		throw new Error('not implemented: constants not yet migrated');
	},

	async app_check_update() {
		// TODO: wire to electrobun Updater API
		return null;
	},

	async app_get_cache_size() {
		// TODO: calculate from cache directories
		return 0;
	},

	async app_clear_cache({ type }) {
		// TODO: delete appropriate cache directory
		throw new Error('not implemented: cache clear');
	},
};
