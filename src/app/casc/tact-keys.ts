/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import fs from 'node:fs/promises';

import { get } from '../generics';

import Constants from '../constants';
import State from '../state';
import Log from '../log';

type KeyRing = Record<string, string>;

const KEY_RING: KeyRing = {};
let isSaving = false;

/**
 * Retrieve a registered decryption key.
 * @param {string} keyName
 */
export function getKey (keyName: string): string {
	return KEY_RING[keyName.toLowerCase()];
}

/**
 * Validate a keyName/key pair.
 * @param keyName - Key name.
 * @param key - Key bytes.
 */
export function validateKeyPair(keyName: string, key: string): boolean {
	if (keyName.length !== 16)
		return false;

	if (key.length !== 32)
		return false;

	return true;
}

/**
 * Add a decryption key. Subject to validation.
 *
 * @remarks
 * Decryption keys will be saved to disk on next tick.
 * @param keyName - Key name.
 * @param key - Key bytes.
 * @returns True if added, else false if the pair failed validation.
 */
export function addKey(keyName: string, key: string): boolean {
	if (!validateKeyPair(keyName, key))
		return false;

	keyName = keyName.toLowerCase();
	key = key.toLowerCase();

	if (KEY_RING[keyName] !== key) {
		KEY_RING[keyName] = key;
		Log.write('Registered new decryption key %s -> %s', keyName, key);
		save();
	}

	return true;
}

/**
 * Load tact keys from disk cache and request updated keys from remote server.
 */
export async function load(): Promise<void> {
	// Load from local cache.
	try {
		const tactKeys = JSON.parse(await fs.readFile(Constants.CACHE.TACT_KEYS, 'utf8'));

		// Validate/add our cached keys manually rather than passing to addKey()
		// to skip over redundant logging/saving calls.
		let added = 0;
		for (const [keyName, key] of Object.entries(tactKeys)) {
			if (validateKeyPair(keyName, (key as string))) {
				KEY_RING[keyName.toLowerCase()] = (key as string).toLowerCase();
				added++;
			} else {
				Log.write('Skipping invalid tact key from cache: %s -> %s', keyName, (key as string));
			}
		}

		Log.write('Loaded %d tact keys from local cache.', added);
	} catch (e) {
		// No tactKeys cached locally, doesn't matter.
	}

	// Update from remote server.
	const res = await get(State.state.config.tactKeysURL);
	if (res.ok) {
		const data = await res.text();
		const lines = data.split(/\r\n|\n|\r/);
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
				Log.write('Skipping invalid remote tact key: %s -> %s', keyName, key);
			}
		}

		if (remoteAdded > 0)
			Log.write('Added %d new tact keys from %s', remoteAdded, State.state.config.tactKeysURL);
	} else {
		Log.write('Unable to update tactKeys, HTTP %d %s', res.status, res.statusText);
	}
}

/**
 * Asynchronously save tact keys to disk.
 */
export async function save(): Promise<void> {
	if (!isSaving) {
		isSaving = true;

		// This is delayed until the next tick so that calls to addKey() can be batched
		// when loading from cache without saving to the disk on every call.
		setImmediate(async () => {
			await fs.writeFile(Constants.CACHE.TACT_KEYS, JSON.stringify(KEY_RING, null, '\t'), 'utf8');
			isSaving = false;
		});
	}
}

export default {
	getKey,
	addKey,
	load,
	save
};