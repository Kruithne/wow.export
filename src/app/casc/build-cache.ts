/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import fs from 'node:fs';

import Log from '../log';
import Constants from '../constants';
import { state } from '../core';
import Events from '../events';
import BufferWrapper from '../buffer';

import { createDirectory, deleteDirectory, readJSON } from '../generics';
import { restartApplication } from '../system';

type BuildMeta = {
	lastAccess?: number;
	lastListfileUpdate?: number;
}

type CacheIntegrity = {
	[x: string]: string;
};

let cacheIntegrity: CacheIntegrity;

/**
 * Returns a promise that resolves once cache integrity is available.
 */
async function cacheIntegrityReady(): Promise<void> {
	return new Promise(res => {
		// Cache integrity already available.
		if (cacheIntegrity)
			return res;

		// Wait for initialization event to fire.
		Log.write('Cache integrity is not ready, waiting!');
		Events.once('cache-integrity-ready', res);
	});
}

export default class BuildCache {
	key: string;
	meta: BuildMeta;
	cacheDir: string;
	manifestPath: string;
	/**
	 * Construct a new BuildCache instance.
	 * @param {string} key
	 */
	constructor(key: string) {
		this.key = key;
		this.meta = {};

		this.cacheDir = path.join(Constants.CACHE.DIR_BUILDS, key);
		this.manifestPath = path.join(this.cacheDir, Constants.CACHE.BUILD_MANIFEST);
	}

	/**
	 * Initialize the build cache instance.
	 */
	async init(): Promise<void> {
		// Create cache directory if needed.
		await fs.promises.mkdir(this.cacheDir, { recursive: true });

		// Load manifest values.
		try {
			const manifest = JSON.parse(await fs.promises.readFile(this.manifestPath, 'utf8'));
			Object.assign(this.meta, manifest);
		} catch (e) {
			Log.write('No cache manifest found for %s', this.key);
		}

		// Save access update without blocking.
		this.meta.lastAccess = Date.now();
		this.saveManifest();
	}

	/**
	 * Attempt to get a file from this build cache.
	 * Returns NULL if the file is not cached.
	 * @param file - File path relative to build cache.
	 * @param dir - Optional override directory.
	 */
	async getFile(file: string, dir?: string): Promise<BufferWrapper> | null {
		try {
			const filePath = this.getFilePath(file, dir);

			// Cache integrity is not loaded yet, wait for it.
			if (!cacheIntegrity)
				await cacheIntegrityReady();

			const integrityHash = cacheIntegrity[filePath];

			// File integrity cannot be verified, reject.
			if (typeof integrityHash !== 'string') {
				Log.write('Cannot verify integrity of file, rejecting cache (%s)', filePath);
				return null;
			}

			const data = new BufferWrapper(await fs.promises.readFile(filePath));
			const dataHash = data.toHash('sha1', 'hex');

			// Reject cache if hash does not match.
			if (dataHash !== integrityHash) {
				Log.write('Bad integrity for file %s, rejecting cache (%s != %s)', filePath, dataHash, integrityHash);
				return null;
			}

			return data;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Get a direct path to a cached file.
	 * @param file - File path relative to build cache.
	 * @param dir - Optional override directory.
	 */
	getFilePath(file: string, dir?: string): string {
		return path.join(dir || this.cacheDir, file);
	}

	/**
	 * Store a file in this build cache.
	 * @param file - File path relative to build cache.
	 * @param data - Data to store in the file.
	 * @param dir - Optional override directory.
	 */
	async storeFile(file: string, data: BufferWrapper, dir?: string): Promise<void> {
		if (!(data instanceof BufferWrapper))
			throw new Error('Data provided to cache.storeFile() must be of BufferWrapper type.');

		const filePath = this.getFilePath(file, dir);
		if (dir)
			await createDirectory(path.dirname(filePath));

		// Cache integrity is not loaded yet, wait for it.
		if (!cacheIntegrity)
			await cacheIntegrityReady();

		// Integrity checking.
		const hash = data.toHash('sha1', 'hex');
		cacheIntegrity[filePath] = hash;

		await fs.promises.writeFile(filePath, data.buffer);
		state.cacheSize += data.length;

		await this.saveCacheIntegrity();
	}

	/**
	 * Save the cache integrity to disk.
	 */
	async saveCacheIntegrity(): Promise<void> {
		await fs.promises.writeFile(Constants.CACHE.INTEGRITY_FILE, JSON.stringify(cacheIntegrity), 'utf8');
	}

	/**
	 * Save the manifest for this build cache.
	 */
	async saveManifest(): Promise<void> {
		await fs.promises.writeFile(this.manifestPath, JSON.stringify(this.meta), 'utf8');
	}
}

// Initialize cache integrity system.
(async function (): Promise<void> {
	try {
		const integrity = await readJSON(Constants.CACHE.INTEGRITY_FILE, false) as CacheIntegrity;
		if (integrity === null)
			throw new Error('File cannot be accessed or contains malformed JSON: ' + Constants.CACHE.INTEGRITY_FILE);

		cacheIntegrity = integrity;
	} catch (e) {
		Log.write('Unable to load cache integrity file; entire cache will be invalidated.');
		Log.write(e.message);

		cacheIntegrity = {};
	}

	Events.emit('cache-integrity-ready');
})();

// Invoked when the user requests a cache purge.
Events.on('click-cache-clear', async () => {
	state.setScreen('config', true);
	state.isBusy++;
	state.setToast('progress', 'Clearing cache, please wait...', null, -1, false);
	Log.write('Manual cache purge requested by user! (Cache size: %s)', state.cacheSizeFormatted);

	await fs.promises.rm(Constants.CACHE.DIR, { recursive: true, force: true });
	await fs.promises.mkdir(Constants.CACHE.DIR);

	state.cacheSize = 0;
	Log.write('Purge complete, awaiting mandatory restart.');
	state.setToast('success', 'Cache has been successfully cleared, a restart is required.', { 'Restart': () => restartApplication() }, -1, false);

	Events.emit('cache-cleared');
});

// Run cache clean-up once a CASC source has been loaded.
// We delay this until here so that we don't potentially mark
// a build as stale and delete it right before the user requests it.
Events.once('casc:loaded', async () => {
	let cacheExpire = Number(state.config.cacheExpiry) || 0;
	cacheExpire *= 24 * 60 * 60 * 1000;

	// If user sets cacheExpiry to 0 in the configuration, we completely
	// skip the clean-up process. This is generally considered a bad idea.
	if (cacheExpire === 0) {
		Log.write('WARNING: Cache clean-up has been skipped due to cacheExpiry being %d', cacheExpire);
		return;
	}

	Log.write('Running clean-up for stale build caches...');
	const entries = await fs.promises.readdir(Constants.CACHE.DIR_BUILDS, { withFileTypes: true });
	const ts = Date.now();

	for (const entry of entries) {
		// We only care about directories with MD5 names.
		// There shouldn't be anything else in there anyway.
		if (!entry.isDirectory() || entry.name.length !== 32)
			continue;

		let deleteEntry = false;
		let manifestSize = 0;
		const entryDir = path.join(Constants.CACHE.DIR_BUILDS, entry.name);
		const entryManifest = path.join(entryDir, Constants.CACHE.BUILD_MANIFEST);

		try {
			const manifestRaw = await fs.promises.readFile(entryManifest, 'utf8');
			const manifest = JSON.parse(manifestRaw);
			manifestSize = Buffer.byteLength(manifestRaw, 'utf8');

			if (!isNaN(manifest.lastAccess)) {
				const delta = ts - manifest.lastAccess;
				if (delta > cacheExpire) {
					deleteEntry = true;
					Log.write('Build cache %s has expired (%d), marking for deletion.', entry.name, delta);
				}
			} else {
				// lastFile property missing from manifest?
				deleteEntry = true;
				Log.write('Unable to read lastAccess from %s, marking for deletion.', entry.name);
			}
		} catch (e) {
			// Manifest is missing or malformed.
			deleteEntry = true;
			Log.write('Unable to read manifest for %s, marking for deletion.', entry.name);
		}

		if (deleteEntry) {
			let deleteSize = await deleteDirectory(entryDir);

			// We don't include manifests in the cache size, so we need to make
			// sure we don't subtract the size of it from our total to maintain accuracy.
			deleteSize -= manifestSize;

			state.cacheSize -= deleteSize;
		}
	}
});