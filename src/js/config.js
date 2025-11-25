/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

let isSaving = false;
let isQueued = false;
let defaultConfig = {};

/**
 * Clone one config object into another.
 * Arrays are cloned rather than passed by reference.
 * @param {object} src 
 * @param {object} target 
 */
const copyConfig = (src, target) => {
	for (const [key, value] of Object.entries(src)) {
		if (Array.isArray(value)) {
			// Clone array rather than passing reference.
			target[key] = value.slice(0);
		} else {
			// Pass everything else in wholemeal.
			target[key] = value;
		}
	}
};

/**
 * Load configuration from disk.
 */
const load = async () => {
	defaultConfig = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};
	const userConfig = await generics.readJSON(constants.CONFIG.USER_PATH) || {};

	log.write('Loaded config defaults: %o', defaultConfig);
	log.write('Loaded user config: %o', userConfig);

	const config = {};
	copyConfig(defaultConfig, config);
	copyConfig(userConfig, config);

	core.view.config = config;
	core.view.$watch('config', () => save(), { deep: true });
};

/**
 * Reset a configuration key to default.
 * @param {string} key 
 */
const resetToDefault = (key) => {
	if (Object.prototype.hasOwnProperty.call(defaultConfig, key))
		core.view.config[key] = defaultConfig[key];
};

/**
 * Reset all configuration to default.
 */
const resetAllToDefault = () => {
	// Use JSON parse/stringify to ensure deep non-referenced clone.
	core.view.config = JSON.parse(JSON.stringify(defaultConfig));
};

/**
 * Mark configuration for saving.
 */
const save = () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	} else {
		// Queue another save.
		isQueued = true;
	}
};

/**
 * Persist configuration data to disk.
 */
const doSave = async () => {
	const configSave = {};
	for (const [key, value] of Object.entries(core.view.config)) {
		// Only persist configuration values that do not match defaults.
		if (Object.prototype.hasOwnProperty.call(defaultConfig, key) && defaultConfig[key] === value)
			continue;

		configSave[key] = value;
	}

	const out = JSON.stringify(configSave, null, '\t');
	await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');

	// If another save was attempted during this one, re-save.
	if (isQueued) {
		isQueued = false;
		doSave();
	} else {
		isSaving = false;
	}
};

module.exports = { load, resetToDefault, resetAllToDefault };