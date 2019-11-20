const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

const config = core.view.config;
let isSaving = false;
let isLoaded = false;

const listeners = new Map();

/**
 * Load configuration from disk.
 */
const load = async () => {
	const defaultConfig = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};
	const userConfig = await generics.readJSON(constants.CONFIG.USER_PATH) || {};

	log.write('Loaded config defaults: %o', defaultConfig);
	log.write('Loaded user config: %o', userConfig);

	Object.assign(config, defaultConfig);
	Object.assign(config, userConfig);

	isLoaded = true;

	// Invoke all listeners registered before config load.
	for (const [key, hooks] of listeners.entries())
		for (const hook of hooks)
			hook(this.get(key));
};

/**
 * Register a callback for when a configuration key is set/updated.
 * Invoked immediately once if configuration is loaded.
 * @param {string} key 
 * @param {function} callback 
 */
const hook = (key, callback) => {
	let hooks = listeners.get(key);
	if (!hooks) {
		hooks = [];
		listeners.set(key, hooks);
	}

	hooks.push(callback);

	if (isLoaded)
		callback(this.get(key));
};

/**
 * Get a configuration value by the given key.
 * Returns NULL if the configuration value does not exist.
 * @param {string} key 
 */
const get = (key) => {
	return config[key] || null;
};

/**
 * Get a configuration value by the given key as a number.
 * Returns NaN if the configuration value does not exist or is not a number.
 * @param {string} key 
 */
const getNumber = (key) => {
	const value = get(key);
	return value === null ? NaN : Number(value);
};

/**
 * Get a configuration value by the given key as a boolean.
 * Returns NULL if the configuration key does not exist.
 * @param {string} key 
 */
const getBool = (key) => {
	const value = get(key);
	return value === null ? null : Boolean(value);
};

/**
 * Get a configuration value by the given key as a string.
 * Returns NULL if the configuration key does not exist.
 * @param {string} key 
 */
const getString = (key) => {
	const value = get(key);
	return value === null ? null : String(value);
};

/**
 * Get a configuration value by the given key as an array.
 * Value is set as an empty array if key is missing or not an array.
 * Returns NULL if the configuration key does not exist.
 * @param {string} key 
 */
const getArray = (key) => {
	let value = get(key);
	if (!Array.isArray(value)) {
		value = [];
		set(key, value);
	}

	return value;
};

/**
 * Set a configuration value.
 * Changes will be persisted to disk on the next tick, allowing
 * consecutive calls in the same tick to be batched.
 * @param {string} key 
 * @param {mixed} value 
 */
const set = (key, value) => {
	config[actualKey] = value;
	log.write('Set configuration value %s -> %s', key, value);

	// Invoke all registered hooks for this config key.
	const hooks = listeners.get(key) || [];
	for (const hook of hooks)
		hook(value);

	save();
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
		const out = JSON.stringify(config, null, '\t');
		await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');
	} catch (e) {
		crash('ERR_CONFIG_SAVE', e.message);
	}
	
	isSaving = false;
};

module.exports = {
	get, getNumber, getBool, getString, getArray, set, load, save, hook
};