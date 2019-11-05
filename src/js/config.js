const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

const config = core.view.config;
let isSaving = false;

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
};

/**
 * Get a configuration value by the given key.
 * Configuration keys can be tiered, such as: foo.bar.sheep
 * Returns NULL if the configuration value does not exist.
 * @param {string} key 
 */
const get = (key) => {
    let node = config;

    // Resolve the configuration key path.
    const parts = key.split('.');
    for (const part of parts) {
        if (!node.hasOwnProperty(part))
            return null;

        node = node[part];
    }

    return node;
};

/**
 * Get a configuration value by the given key as a number.
 * Configuration keys can be tiered, such as: foo.bar.sheep
 * Returns NaN if the configuration value does not exist or is not a number.
 * @param {string} key 
 */
const getNumber = (key) => {
    const value = get(key);
    return value === null ? NaN : Number(value);
};

/**
 * Get a configuration value by the given key as a boolean.
 * Configuration keys can be tiered, such as: foo.bar.sheep
 * Returns NULL if the configuration key does not exist.
 * @param {string} key 
 */
const getBool = (key) => {
    const value = get(key);
    return value === null ? null : Boolean(value);
};

/**
 * Get a configuration value by the given key as a string.
 * Configuration keys can be tiered, such as: foo.bar.sheep
 * Returns NULL if the configuration key does not exist.
 * @param {string} key 
 */
const getString = (key) => {
    const value = get(key);
    return value === null ? null : String(value);
};

/**
 * Set a configuration value.
 * Configuration keys can be tiered, such as: foo.bar.sheep
 * Changes will be persisted to disk on the next tick, allowing
 * consecutive calls in the same tick to be batched.
 * @param {string} key 
 * @param {mixed} value 
 */
const set = (key, value) => {
    let node = config;

    // Resolve configuration key path.
    const parts = key.split('.');
    const actualKey = parts.pop();
    for (const part of parts) {
        if (!node.hasOwnProperty(part))
            node[part] = {};

        node = node[part];
    }

    node[actualKey] = value;
    log.write('Set configuration value %s -> %s', key, value);

    if (!isSaving) {
        isSaving = true;
        setImmediate(save);
    }
};

/**
 * Persist configuration data to disk.
 */
const save = async () => {
    try {
        const out = JSON.stringify(config, null, '\t');
        await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');
    } catch (e) {
        crash('ERR_CONFIG_SAVE', e.message);
    }
    
    isSaving = false;
};

module.exports = {
    get, getNumber, getBool, getString, set, load
};