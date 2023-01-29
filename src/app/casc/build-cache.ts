/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import fsp from 'node:fs/promises';
import * as log from '../log';
import constants from '../constants';
import * as generics from '../generics';
import * as core from '../core';
import BufferWrapper from '../buffer';

let cacheIntegrity: { [x: string]: string; };

/**
 * Returns a promise that resolves once cache integrity is available.
 */
const cacheIntegrityReady = async () => {
	return new Promise(res => {
		// Cache integrity already available.
		if (cacheIntegrity)
			return res;

		// Wait for initialization event to fire.
		log.write('Cache integrity is not ready, waiting!');
		core.events.once('cache-integrity-ready', res);
	});
};

export default class BuildCache {
	key: string;
	meta: any;
	cacheDir: string;
	manifestPath: string;
	/**
	 * Construct a new BuildCache instance.
	 * @param {string} key
	 */
	constructor(key: string) {
		this.key = key;
		this.meta = {};

		this.cacheDir = path.join(constants.CACHE.DIR_BUILDS, key);
		this.manifestPath = path.join(this.cacheDir, constants.CACHE.BUILD_MANIFEST);
	}

	/**
	 * Initialize the build cache instance.
	 */
	async init() {
		// Create cache directory if needed.
		await fsp.mkdir(this.cacheDir, { recursive: true });

		// Load manifest values.
		try {
			const manifest = JSON.parse(await fsp.readFile(this.manifestPath, 'utf8'));
			Object.assign(this.meta, manifest);
		} catch (e) {
			log.write('No cache manifest found for %s', this.key);
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
	async getFile(file: string, dir?: string): Promise<BufferWrapper>|null {
		try {
			const filePath = this.getFilePath(file, dir);

			// Cache integrity is not loaded yet, wait for it.
			if (!cacheIntegrity)
				await cacheIntegrityReady();

			const integrityHash = cacheIntegrity[filePath];

			// File integrity cannot be verified, reject.
			if (typeof integrityHash !== 'string') {
				log.write('Cannot verify integrity of file, rejecting cache (%s)', filePath);
				return null;
			}

			const data = await BufferWrapper.readFile(filePath);
			const dataHash = data.calculateHash('sha1', 'hex');

			// Reject cache if hash does not match.
			if (dataHash !== integrityHash) {
				log.write('Bad integrity for file %s, rejecting cache (%s != %s)', filePath, dataHash, integrityHash);
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
			await generics.createDirectory(path.dirname(filePath));

		// Cache integrity is not loaded yet, wait for it.
		if (!cacheIntegrity)
			await cacheIntegrityReady();

		// Integrity checking.
		const hash = data.calculateHash('sha1', 'hex');
		cacheIntegrity[filePath] = hash;

		await fsp.writeFile(filePath, data.raw);
		core.view.cacheSize += data.byteLength;

		await this.saveCacheIntegrity();
	}

	/**
	 * Save the cache integrity to disk.
	 */
	async saveCacheIntegrity(): Promise<void> {
		await fsp.writeFile(constants.CACHE.INTEGRITY_FILE, JSON.stringify(cacheIntegrity), 'utf8');
	}

	/**
	 * Save the manifest for this build cache.
	 */
	async saveManifest(): Promise<void> {
		await fsp.writeFile(this.manifestPath, JSON.stringify(this.meta), 'utf8');
	}
}

// Initialize cache integrity system.
(async () => {
	try {
		const integrity = await generics.readJSON(constants.CACHE.INTEGRITY_FILE, false);
		if (integrity === null)
			throw new Error('File cannot be accessed or contains malformed JSON: ' + constants.CACHE.INTEGRITY_FILE);

		cacheIntegrity = integrity;
	} catch (e) {
		log.write('Unable to load cache integrity file; entire cache will be invalidated.');
		log.write(e.message);

		cacheIntegrity = {};
	}

	core.events.emit('cache-integrity-ready');
})();

// Invoked when the user requests a cache purge.
core.events.on('click-cache-clear', async () => {
	core.view.setScreen('config', true);
	core.view.isBusy++;
	core.setToast('progress', 'Clearing cache, please wait...', null, -1, false);
	log.write('Manual cache purge requested by user! (Cache size: %s)', core.view.cacheSizeFormatted);

	await fsp.rm(constants.CACHE.DIR, { recursive: true, force: true });
	await fsp.mkdir(constants.CACHE.DIR);

	core.view.cacheSize = 0;
	log.write('Purge complete, awaiting mandatory restart.');
	core.setToast('success', 'Cache has been successfully cleared, a restart is required.', { 'Restart': () => core.view.restartApplication() }, -1, false);

	core.events.emit('cache-cleared');
});

// Run cache clean-up once a CASC source has been selected.
// We delay this until here so that we don't potentially mark
// a build as stale and delete it right before the user requests it.
core.events.once('casc-source-changed', async () => {
	let cacheExpire = Number(core.view.config.cacheExpiry) || 0;
	cacheExpire *= 24 * 60 * 60 * 1000;

	// If user sets cacheExpiry to 0 in the configuration, we completely
	// skip the clean-up process. This is generally considered a bad idea.
	if (cacheExpire === 0) {
		log.write('WARNING: Cache clean-up has been skipped due to cacheExpiry being %d', cacheExpire);
		return;
	}

	log.write('Running clean-up for stale build caches...');
	const entries = await fsp.readdir(constants.CACHE.DIR_BUILDS, { withFileTypes: true });
	const ts = Date.now();

	for (const entry of entries) {
		// We only care about directories with MD5 names.
		// There shouldn't be anything else in there anyway.
		if (!entry.isDirectory() || entry.name.length !== 32)
			continue;

		let deleteEntry = false;
		let manifestSize = 0;
		const entryDir = path.join(constants.CACHE.DIR_BUILDS, entry.name);
		const entryManifest = path.join(entryDir, constants.CACHE.BUILD_MANIFEST);

		try {
			const manifestRaw = await fsp.readFile(entryManifest, 'utf8');
			const manifest = JSON.parse(manifestRaw);
			manifestSize = Buffer.byteLength(manifestRaw, 'utf8');

			if (!isNaN(manifest.lastAccess)) {
				const delta = ts - manifest.lastAccess;
				if (delta > cacheExpire) {
					deleteEntry = true;
					log.write('Build cache %s has expired (%d), marking for deletion.', entry.name, delta);
				}
			} else {
				// lastFile property missing from manifest?
				deleteEntry = true;
				log.write('Unable to read lastAccess from %s, marking for deletion.', entry.name);
			}
		} catch (e) {
			// Manifest is missing or malformed.
			deleteEntry = true;
			log.write('Unable to read manifest for %s, marking for deletion.', entry.name);
		}

		if (deleteEntry) {
			let deleteSize = await generics.deleteDirectory(entryDir);

			// We don't include manifests in the cache size, so we need to make
			// sure we don't subtract the size of it from our total to maintain accuracy.
			deleteSize -= manifestSize;

			core.view.cacheSize -= deleteSize;
		}
	}
});