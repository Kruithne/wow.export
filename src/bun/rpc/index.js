import { filesystem_handlers } from './filesystem.js';
import { casc_handlers, listfile_handlers } from './casc.js';
import { db_handlers, db_cache_handlers } from './db.js';
import { platform_handlers } from './platform.js';
import { config_handlers, app_handlers, init_config, get_config_ref } from './config.js';
import { export_handlers, log_handlers, handle_log_write, handle_export_cancel, init_export } from './export.js';
import { mpq_handlers } from './mpq.js';
import { MSG } from '../../rpc/schema.js';

import * as log_lib from '../lib/log.js';
import * as constants_lib from '../lib/constants.js';
import * as core_lib from '../lib/core.js';
import { init_cache_integrity } from '../casc/build-cache.js';

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
			...mpq_handlers,
		},

		messages: {
			[MSG.LOG_WRITE]: handle_log_write,
			[MSG.EXPORT_CANCEL]: handle_export_cancel,
		},
	};
}

export async function init_services(paths, rpc) {
	// initialize foundation libs
	log_lib.init(paths.log);
	constants_lib.init(paths);

	// initialize rpc-dependent services
	init_config(paths, rpc);
	init_export(paths, rpc);

	// ensure config is loaded before initializing core
	await config_handlers.config_get();
	const config_ref = get_config_ref();
	core_lib.init(rpc, config_ref);

	// initialize cache integrity system
	await init_cache_integrity();
	await core_lib.load_cache_size();

	log_lib.write('bun-side services initialized');
}
