import * as log from '../lib/log.js';
import fsp from 'node:fs/promises';
import * as generics from '../lib/generics.js';
import * as constants from '../lib/constants.js';
import * as core from '../lib/core.js';

const KEY_RING = {};
let isSaving = false;

const getKey = (keyName) => {
	return KEY_RING[keyName.toLowerCase()];
};

const validateKeyPair = (keyName, key) => {
	if (keyName.length !== 16)
		return false;

	if (key.length !== 32)
		return false;

	return true;
};

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

const load = async () => {
	try {
		const tactKeys = JSON.parse(await fsp.readFile(constants.CACHE.TACT_KEYS, 'utf8'));

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
		// no tactKeys cached locally
	}

	const tact_url = core.get_config('tactKeysURL');
	const tact_url_fallback = core.get_config('tactKeysFallbackURL');
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

const save = async () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	}
};

const doSave = async () => {
	await fsp.writeFile(constants.CACHE.TACT_KEYS, JSON.stringify(KEY_RING, null, '\t'), 'utf8');
	isSaving = false;
};

export { load, getKey, addKey };
