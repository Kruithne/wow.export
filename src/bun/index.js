import { BrowserWindow, BrowserView, Utils } from 'electrobun/bun';
import path from 'node:path';
import { create_handlers, init_services } from './rpc/index.js';
import { MAX_REQUEST_TIME } from '../rpc/schema.js';

const install_path = path.resolve(import.meta.dir, '..', '..');
const version_info = await Bun.file(path.join(import.meta.dir, '..', '..', 'version.json')).json();

const data_path = Utils.paths.userData;

const app_paths = {
	data: data_path,
	log: path.join(data_path, 'wow-export.log'),
	user_config: path.join(data_path, 'config.json'),
	default_config: path.join(import.meta.dir, '..', 'default_config.jsonc'),
	cache: path.join(data_path, 'cache'),
	install: install_path,
	version: version_info.version,
};

const handlers = create_handlers(null);

const rpc = BrowserView.defineRPC({
	maxRequestTime: MAX_REQUEST_TIME,
	handlers,
});

await init_services(app_paths, rpc);

const win = new BrowserWindow({
	title: 'wow.export',
	url: 'views://main/index.html',
	renderer: 'cef',
	frame: { width: 1200, height: 800, x: 100, y: 100 },
	titleBarStyle: 'default',
	transparent: false,
	sandbox: false,
	rpc,
});
