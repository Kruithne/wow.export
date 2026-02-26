// view-side RPC client for wow.export
// provides ergonomic API over electrobun's raw rpc.request.* calls

import { Electroview } from 'electrobun/view';
import { MAX_REQUEST_TIME, MSG } from '../../rpc/schema.js';

// event bus for bun→view messages
const _listeners = new Map();

function emit(event, payload) {
	const handlers = _listeners.get(event);
	if (handlers)
		for (const fn of handlers) fn(payload);
}

const rpc_config = Electroview.defineRPC({
	maxRequestTime: MAX_REQUEST_TIME,
	handlers: {
		requests: {},

		messages: {
			[MSG.CASC_PROGRESS](payload) { emit(MSG.CASC_PROGRESS, payload); },
			[MSG.EXPORT_PROGRESS](payload) { emit(MSG.EXPORT_PROGRESS, payload); },
			[MSG.LOADING_PROGRESS](payload) { emit(MSG.LOADING_PROGRESS, payload); },
			[MSG.CONFIG_CHANGED](payload) { emit(MSG.CONFIG_CHANGED, payload); },
			[MSG.TOAST](payload) { emit(MSG.TOAST, payload); },
		},
	},
});

export const electrobun = new Electroview({ rpc: rpc_config });

// -- event API for progress/notification messages --

export function on(event, handler) {
	if (!_listeners.has(event))
		_listeners.set(event, new Set());

	_listeners.get(event).add(handler);
}

export function off(event, handler) {
	_listeners.get(event)?.delete(handler);
}

// -- helper: request with progress tracking --

export async function request_with_progress(method, params, progress_event, on_progress) {
	on(progress_event, on_progress);

	try {
		return await rpc_config.request[method](params);
	} finally {
		off(progress_event, on_progress);
	}
}

// -- binary helpers --

export function decode_binary(base64_str) {
	const binary = atob(base64_str);
	const len = binary.length;
	const bytes = new Uint8Array(len);

	for (let i = 0; i < len; i++)
		bytes[i] = binary.charCodeAt(i);

	return bytes.buffer;
}

export function encode_binary(array_buffer) {
	const bytes = new Uint8Array(array_buffer);
	const chunk_size = 8192;
	let binary = '';

	for (let i = 0; i < bytes.length; i += chunk_size)
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk_size));

	return btoa(binary);
}

// -- filesystem API --

export const fs = {
	async read_file(path, offset, length) {
		const data = await rpc_config.request.fs_read_file({ path, offset, length });
		return decode_binary(data);
	},

	write_file: (path, data) => rpc_config.request.fs_write_file({ path, data: encode_binary(data) }),
	write_text: (path, text, encoding) => rpc_config.request.fs_write_text({ path, text, encoding }),
	mkdir: (path) => rpc_config.request.fs_mkdir({ path }),
	exists: (path) => rpc_config.request.fs_exists({ path }),
	readdir: (path) => rpc_config.request.fs_readdir({ path }),
	stat: (path) => rpc_config.request.fs_stat({ path }),
	delete_dir: (path) => rpc_config.request.fs_delete_dir({ path }),
	is_writable: (path) => rpc_config.request.fs_is_writable({ path }),
	file_hash: (path, algorithm, encoding) => rpc_config.request.fs_file_hash({ path, algorithm, encoding }),
	read_json: (path, strip_comments) => rpc_config.request.fs_read_json({ path, strip_comments }),
	write_json: (path, data) => rpc_config.request.fs_write_json({ path, data }),
};

// -- casc API --

export const casc = {
	init_local: (path, on_progress) => request_with_progress('casc_init_local', { path }, MSG.CASC_PROGRESS, on_progress),
	init_remote: (region, product, on_progress) => request_with_progress('casc_init_remote', { region, product }, MSG.CASC_PROGRESS, on_progress),
	load: (build_index, cdn_region) => rpc_config.request.casc_load({ build_index, cdn_region }),
	close: () => rpc_config.request.casc_close(),
	get_file: async (file_data_id) => decode_binary(await rpc_config.request.casc_get_file({ file_data_id })),
	get_file_by_name: async (name) => decode_binary(await rpc_config.request.casc_get_file_by_name({ name })),
	get_file_partial: async (file_data_id, offset, length) => decode_binary(await rpc_config.request.casc_get_file_partial({ file_data_id, offset, length })),
};

// -- listfile API --

export const listfile = {
	get_by_id: (id) => rpc_config.request.listfile_get_by_id({ id }),
	get_by_name: (name) => rpc_config.request.listfile_get_by_name({ name }),
	get_filtered: (filter, ext, prefilter) => rpc_config.request.listfile_get_filtered({ filter, ext, prefilter }),
	get_prefilter: (type) => rpc_config.request.listfile_get_prefilter({ type }),
	strip_prefix: (name) => rpc_config.request.listfile_strip_prefix({ name }),
};

// -- db API --

export const db = {
	load: (table) => rpc_config.request.db_load({ table }),
	preload: (table) => rpc_config.request.db_preload({ table }),
	get_row: (table, id) => rpc_config.request.db_get_row({ table, id }),
};

// -- db cache API --

export const dbc = {
	call: (module, method, args) => rpc_config.request.dbc_call({ module, method, args }),
	get_items: (filter) => rpc_config.request.dbc_get_items({ filter }),
	get_item_displays: (item_id) => rpc_config.request.dbc_get_item_displays({ item_id }),
	get_item_models: (display_id) => rpc_config.request.dbc_get_item_models({ display_id }),
	get_item_geosets: (item_id) => rpc_config.request.dbc_get_item_geosets({ item_id }),
	get_item_char_textures: (item_id) => rpc_config.request.dbc_get_item_char_textures({ item_id }),
	get_creatures: (filter) => rpc_config.request.dbc_get_creatures({ filter }),
	get_creature_displays: (creature_id) => rpc_config.request.dbc_get_creature_displays({ creature_id }),
	get_creature_equipment: (creature_id) => rpc_config.request.dbc_get_creature_equipment({ creature_id }),
	get_character_customization: (race, gender) => rpc_config.request.dbc_get_character_customization({ race, gender }),
	get_model_file_data: (model_id) => rpc_config.request.dbc_get_model_file_data({ model_id }),
	get_texture_file_data: (texture_id) => rpc_config.request.dbc_get_texture_file_data({ texture_id }),
	get_component_models: (race, gender, class_id) => rpc_config.request.dbc_get_component_models({ race, gender, class: class_id }),
	get_decor: (filter) => rpc_config.request.dbc_get_decor({ filter }),
	get_decor_categories: () => rpc_config.request.dbc_get_decor_categories(),
	get_guild_tabard: (params) => rpc_config.request.dbc_get_guild_tabard(params),
	init_creature_data_legacy: () => rpc_config.request.dbc_init_creature_data_legacy(),
	get_creature_displays_by_path_legacy: (model_path) => rpc_config.request.dbc_get_creature_displays_by_path_legacy({ model_path }),
};

// -- platform API --

export const platform = {
	open_path: (path) => rpc_config.request.platform_open_path({ path }),
	open_url: (url) => rpc_config.request.platform_open_url({ url }),
	clipboard_write_text: (text) => rpc_config.request.platform_clipboard_write_text({ text }),
	clipboard_write_image: (data) => rpc_config.request.platform_clipboard_write_image({ data: encode_binary(data) }),
	clipboard_read_text: () => rpc_config.request.platform_clipboard_read_text(),
	show_open_dialog: (opts) => rpc_config.request.platform_show_open_dialog(opts ?? {}),
	show_save_dialog: (opts) => rpc_config.request.platform_show_save_dialog(opts ?? {}),
	get_gpu_info: () => rpc_config.request.platform_get_gpu_info(),
	get_screen_info: () => rpc_config.request.platform_get_screen_info(),
};

// -- config API --

export const config = {
	get: () => rpc_config.request.config_get(),
	set: (key, value) => rpc_config.request.config_set({ key, value }),
	reset_key: (key) => rpc_config.request.config_reset_key({ key }),
	reset_all: () => rpc_config.request.config_reset_all(),
	get_defaults: () => rpc_config.request.config_get_defaults(),
};

// -- app API --

export const app = {
	get_info: () => rpc_config.request.app_get_info(),
	get_constants: () => rpc_config.request.app_get_constants(),
	check_update: () => rpc_config.request.app_check_update(),
	get_cache_size: () => rpc_config.request.app_get_cache_size(),
	clear_cache: (type) => rpc_config.request.app_clear_cache({ type }),
};

// -- export API --

export const exporter = {
	export_files: (files, dir, format, on_progress) => request_with_progress('export_files', { files, dir, format }, MSG.EXPORT_PROGRESS, on_progress),
	export_raw: (data, path) => rpc_config.request.export_raw({ data: encode_binary(data), path }),
	export_text: (text, path) => rpc_config.request.export_text({ text, path }),
	get_path: (file) => rpc_config.request.export_get_path({ file }),
	get_incremental: (path) => rpc_config.request.export_get_incremental({ path }),
};

// -- mpq API --

export const mpq = {
	init: (path) => rpc_config.request.mpq_init({ path }),
	close: () => rpc_config.request.mpq_close(),

	get_file: async (path) => {
		const data = await rpc_config.request.mpq_get_file({ path });
		if (data === null)
			return null;

		return decode_binary(data);
	},

	get_files_by_extension: (extension) => rpc_config.request.mpq_get_files_by_extension({ extension }),
	get_all_files: () => rpc_config.request.mpq_get_all_files(),
	get_build_id: () => rpc_config.request.mpq_get_build_id(),
};

// -- log API (sends messages to bun, no response expected) --

export const log = {
	write: (level, message, ...args) => rpc_config.send[MSG.LOG_WRITE]({ level, message, args }),
	info: (message, ...args) => rpc_config.send[MSG.LOG_WRITE]({ level: 'info', message, args }),
	warn: (message, ...args) => rpc_config.send[MSG.LOG_WRITE]({ level: 'warn', message, args }),
	error: (message, ...args) => rpc_config.send[MSG.LOG_WRITE]({ level: 'error', message, args }),
	get_path: () => rpc_config.request.log_get_path(),
	open: () => rpc_config.request.log_open(),
};
