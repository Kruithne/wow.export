import { BrowserWindow, BrowserView, PATHS } from 'electrobun/bun';
import path from 'node:path';
import { create_handlers, init_services } from './rpc/index.js';
import { MAX_REQUEST_TIME } from '../rpc/schema.js';

const install_path = path.resolve(import.meta.dir, '..', '..');

const app_paths = {
	data: PATHS.data,
	log: path.join(PATHS.data, 'wow-export.log'),
	user_config: path.join(PATHS.data, 'config.json'),
	default_config: path.join(import.meta.dir, '..', 'default_config.jsonc'),
	cache: path.join(PATHS.data, 'cache'),
	install: install_path,
	version: '0.2.14',
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
