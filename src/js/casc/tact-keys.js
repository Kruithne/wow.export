/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../log');
const fsp = require('fs').promises;
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');

const KEY_RING = {};
let isSaving = false;

/**
 * Retrieve a registered decryption key.
 * @param {string} keyName 
 */
const getKey = (keyName) => {
	return KEY_RING[keyName.toLowerCase()];
};

/**
 * Validate a keyName/key pair.
 * @param {string} keyName 
 * @param {string} key 
 */
const validateKeyPair = (keyName, key) => {
	if (keyName.length !== 16)
		return false;

	if (key.length !== 32)
		return false;

	return true;
};

/**
 * Add a decryption key. Subject to validation.
 * Decryption keys will be saved to disk on next tick.
 * Returns true if added, else false if the pair failed validation.
 * @param {string} keyName 
 * @param {string} key 
 */
const addKey = (keyName, key) => {
	if (!validateKeyPair(keyName, key))
		return false;

	keyName = keyName.toLowerCase();
	key = key.toLowerCase();

	if (KEY_RING[keyName] !== key) {
		KEY_RING[keyName] = key;
		log.write('Registered new decryption key %s -> %s', keyName, key);
		save();
	}

	return true;
};

/**
 * Load tact keys from disk cache and request updated
 * keys from remote server.
 */
const load = async () => {
	// Load from local cache.
	try {
		const tactKeys = JSON.parse(await fsp.readFile(constants.CACHE.TACT_KEYS, 'utf8'));

		// Validate/add our cached keys manually rather than passing to addKey()
		// to skip over redundant logging/saving calls.
		let added = 0;
		for (const [keyName, key] of Object.entries(tactKeys)) {
			if (validateKeyPair(keyName, key)) {
				KEY_RING[keyName.toLowerCase()] = key.toLowerCase();
				added++;
			} else {
				log.write('Skipping invalid tact key from cache: %s -> %s', keyName, key);
			}
		}

		log.write('Loaded %d tact keys from local cache.', added);
	} catch (e) {
		// No tactKeys cached locally, doesn't matter.
	}

	const tact_url = core.view.config.tactKeysURL;
	const tact_url_fallback = core.view.config.tactKeysFallbackURL;
	const res = await generics.get([tact_url, tact_url_fallback]);

	if (!res.ok)
		throw new Error(`Unable to update tactKeys, HTTP ${res.status}`);

	const data = await res.text();
	const lines = data.split(/\r?\n/);
	let remoteAdded = 0;
	
	for (const line of lines) {
		const parts = line.split(' ');
		if (parts.length !== 2)
			continue;

		const keyName = parts[0].trim();
		const key = parts[1].trim();

		if (validateKeyPair(keyName, key)) {
			KEY_RING[keyName.toLowerCase()] = key.toLowerCase();
			remoteAdded++;
		} else {
			log.write('Skipping invalid remote tact key: %s -> %s', keyName, key);
		}
	}

	if (remoteAdded > 0)
		log.write('Added %d tact keys from %s', remoteAdded, tact_url);
};

/**
 * Request for tact keys to be saved on the next tick.
 * Multiple calls can be chained in the same tick.
 */
const save = async () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	}
};

/**
 * Saves the tact keys to disk.
 */
const doSave = async () => {
	await fsp.writeFile(constants.CACHE.TACT_KEYS, JSON.stringify(KEY_RING, null, '\t'), 'utf8');
	isSaving = false;
};

module.exports = { load, getKey, addKey };