import { app, platform as rpc_platform } from '../views/main/rpc.js';

let _app_info = null;

export async function init() {
	_app_info = await app.get_info();
}

export const open_path = (path) => rpc_platform.open_path(path);
export const open_url = (url) => rpc_platform.open_url(url);

export const clipboard_write_text = (text) => rpc_platform.clipboard_write_text(text);
export const clipboard_write_image = (data) => rpc_platform.clipboard_write_image(data);

export const get_version = () => _app_info?.version ?? '0.0.0';
export const get_flavour = () => _app_info?.flavour ?? 'unknown';
export const get_guid = () => _app_info?.guid ?? '';
export const get_data_path = () => _app_info?.data_path ?? '';
export const get_manifest = () => _app_info ?? { version: '0.0.0', flavour: 'unknown', guid: '' };
