import { app, platform as rpc_platform, fs } from '../views/main/rpc.js';

let _app_info = null;

export async function init() {
	_app_info = await app.get_info();
}

export const open_path = (path) => rpc_platform.open_path(path);
export const open_url = (url) => rpc_platform.open_url(url);

export const clipboard_write_text = (text) => rpc_platform.clipboard_write_text(text);
export const clipboard_write_image = (data) => rpc_platform.clipboard_write_image(data);

export const show_open_dialog = (opts) => rpc_platform.show_open_dialog(opts);

export const read_file = (path, encoding) => fs.read_file(path);
export const read_file_bytes = (path) => fs.read_file(path);
export const write_file = (path, data) => fs.write_file(path, data);
export const readdir = (path) => fs.readdir(path);
export const readdir_with_types = (path) => fs.readdir_with_types(path);
export const access = (path) => fs.access(path);
export const unlink = (path) => fs.unlink(path);
export const mkdir = (path) => fs.mkdir(path);
export const copy_file = (src, dest) => fs.copy_file(src, dest);

export const get_version = () => _app_info?.version ?? '0.0.0';
export const get_flavour = () => _app_info?.flavour ?? 'unknown';
export const get_guid = () => _app_info?.guid ?? '';
export const get_data_path = () => _app_info?.data_path ?? '';
export const get_home_dir = () => _app_info?.home_dir ?? '';
export const get_manifest = () => _app_info ?? { version: '0.0.0', flavour: 'unknown', guid: '' };
