// composes all bun-side RPC handlers into a single handlers object
// for use with BrowserView.defineRPC()

import { filesystem_handlers } from './filesystem.js';
import { casc_handlers, listfile_handlers } from './casc.js';
import { db_handlers, db_cache_handlers } from './db.js';
import { platform_handlers } from './platform.js';
import { config_handlers, app_handlers, init_config } from './config.js';
import { export_handlers, log_handlers, handle_log_write, init_export } from './export.js';
import { MSG } from '../../rpc/schema.js';

export function create_handlers(rpc) {
	return {
		requests: {
			...filesystem_handlers,
			...casc_handlers,
			...listfile_handlers,
			...db_handlers,
			...db_cache_handlers,
			...platform_handlers,
			...config_handlers,
			...app_handlers,
			...export_handlers,
			...log_handlers,
		},

		messages: {
			[MSG.LOG_WRITE]: handle_log_write,
		},
	};
}

export function init_services(paths, rpc) {
	init_config(paths, rpc);
	init_export(paths, rpc);
}
