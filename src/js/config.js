const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

let isSaving = false;

/**
 * Load configuration from disk.
 */
const load = async () => {
	const defaultConfig = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};
	const userConfig = await generics.readJSON(constants.CONFIG.USER_PATH) || {};

	log.write('Loaded config defaults: %o', defaultConfig);
	log.write('Loaded user config: %o', userConfig);

	const config = Object.assign({}, defaultConfig, userConfig);
	core.view.config = config;

	core.view.$watch('config', () => save(), { deep: true });
};

/**
 * Mark configuration for saving.
 */
const save = () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	}
};

/**
 * Persist configuration data to disk.
 */
const doSave = async () => {
	try {
		const out = JSON.stringify(core.view.config, null, '\t');
		await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');
	} catch (e) {
		crash('ERR_CONFIG_SAVE', e.message);
	}
	
	isSaving = false;
};

module.exports = { load };