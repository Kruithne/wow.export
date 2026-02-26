import { config as rpc_config, on } from '../views/main/rpc.js';
import { MSG } from '../rpc/schema.js';
import core from './core.js';
import log from './log.js';

let default_config = {};
let is_saving = false;
let save_timer = -1;

const copy_config = (src, target) => {
	for (const [key, value] of Object.entries(src))
		target[key] = Array.isArray(value) ? value.slice(0) : value;
};

export const load = async () => {
	default_config = await rpc_config.get_defaults() ?? {};
	const user_config = await rpc_config.get() ?? {};

	log.write('Loaded config defaults: %o', default_config);
	log.write('Loaded user config: %o', user_config);

	const config = {};
	copy_config(default_config, config);
	copy_config(user_config, config);

	core.view.config = config;
	core.view.$watch('config', () => save(), { deep: true });

	on(MSG.CONFIG_CHANGED, ({ key, value }) => {
		if (core.view.config[key] !== value)
			core.view.config[key] = value;
	});
};

export const resetToDefault = (key) => {
	if (Object.prototype.hasOwnProperty.call(default_config, key))
		core.view.config[key] = default_config[key];
};

export const resetAllToDefault = () => {
	core.view.config = JSON.parse(JSON.stringify(default_config));
};

const save = () => {
	if (save_timer !== -1)
		clearTimeout(save_timer);

	save_timer = setTimeout(do_save, 50);
};

const do_save = async () => {
	if (is_saving)
		return;

	is_saving = true;

	try {
		for (const [key, value] of Object.entries(core.view.config)) {
			if (Object.prototype.hasOwnProperty.call(default_config, key) && default_config[key] === value)
				continue;

			await rpc_config.set(key, value);
		}
	} finally {
		is_saving = false;
	}
};

export default { load, resetToDefault, resetAllToDefault };
