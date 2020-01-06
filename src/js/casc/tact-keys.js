const log = require('../log');
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

	// Update from remote server.
	const res = await generics.get(core.view.config.tactKeysURL);
	if (res.statusCode === 200) {
		const data = await generics.consumeUTF8Stream(res);
		const lines = data.split(/\r\n|\n|\r/);
		
		for (const line of lines) {
			const parts = line.split(' ');
			if (parts.length !== 2)
				continue;

			addKey(parts[0].trim(), parts[1].trim());
		}
	} else {
		log.write('Unable to update tactKeys, HTTP %d', res.statusCode);
	}
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