import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import * as constants from './constants.js';
import { MSG } from '../../rpc/schema.js';

export const events = new EventEmitter();

let _rpc = null;
let _config = null;
let _casc = null;
let _mpq = null;
let _cache_size = 0;
let _selected_cdn_region = null;
let _is_busy = 0;
let _export_cancelled = false;

export const init = (rpc, config_ref) => {
	_rpc = rpc;
	_config = config_ref;
};

// casc instance management
export const get_casc = () => _casc;
export const set_casc = (casc) => {
	_casc = casc;
	events.emit('casc-source-changed', casc);
};

// mpq instance management
export const get_mpq = () => _mpq;
export const set_mpq = (mpq) => { _mpq = mpq; };

// config access
export const get_config = (key) => {
	if (!_config)
		return undefined;

	if (key)
		return _config[key];

	return _config;
};

// cache size
let _cache_size_timer = -1;

export const get_cache_size = () => _cache_size;
export const set_cache_size = (size) => {
	_cache_size = size;

	clearTimeout(_cache_size_timer);
	_cache_size_timer = setTimeout(() => {
		fs.writeFile(constants.CACHE.SIZE, String(size), 'utf8').catch(() => {});
	}, constants.CACHE.SIZE_UPDATE_DELAY);
};

export const load_cache_size = async () => {
	try {
		const data = await fs.readFile(constants.CACHE.SIZE, 'utf8');
		_cache_size = Number(data) || 0;
	} catch {
		_cache_size = 0;
	}
};

// cdn region
export const get_selected_cdn_region = () => _selected_cdn_region;
export const set_selected_cdn_region = (region) => {
	_selected_cdn_region = region;
};

// busy state
export const get_is_busy = () => _is_busy > 0;
export const increment_busy = () => { _is_busy++; };
export const decrement_busy = () => { _is_busy = Math.max(0, _is_busy - 1); };

// export cancellation
export const get_export_cancelled = () => _export_cancelled;
export const set_export_cancelled = (val) => { _export_cancelled = val; };

// rpc messaging helpers
export const show_loading_screen = (steps) => {
	_rpc?.send?.[MSG.LOADING_SCREEN]?.({ visible: true, steps });
};

export const progress_loading_screen = (text) => {
	_rpc?.send?.[MSG.LOADING_PROGRESS]?.({ message: text });
};

export const hide_loading_screen = () => {
	_rpc?.send?.[MSG.LOADING_SCREEN]?.({ visible: false });
};

export const set_toast = (type, message, options = null, timeout = -1, cancellable = true) => {
	_rpc?.send?.[MSG.TOAST]?.({ type, message, options, timeout, cancellable });
};

export const send_listfile_data = (key, data) => {
	_rpc?.send?.listfile_data?.({ key, data });
};

// disposable busy lock (using Symbol.dispose)
export const create_busy_lock = () => {
	_is_busy++;
	return {
		[Symbol.dispose]() {
			_is_busy = Math.max(0, _is_busy - 1);
		}
	};
};

// get rpc reference
export const get_rpc = () => _rpc;
