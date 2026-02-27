import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import * as log from '../lib/log.js';
import * as constants from '../lib/constants.js';
import * as generics from '../lib/generics.js';
import * as core from '../lib/core.js';
import BufferWrapper from '../lib/buffer.js';
import * as mmap from '../lib/mmap.js';

let cacheIntegrity;

const cacheIntegrityReady = async () => {
	return new Promise(res => {
		if (cacheIntegrity)
			return res();

		log.write('Cache integrity is not ready, waiting!');
		core.events.once('cache-integrity-ready', res);
	});
};

class BuildCache {
	constructor(key) {
		this.key = key;
		this.meta = {};

		this.cacheDir = path.join(constants.CACHE.DIR_BUILDS, key);
		this.manifestPath = path.join(this.cacheDir, constants.CACHE.BUILD_MANIFEST);
	}

	async init() {
		await fsp.mkdir(this.cacheDir, { recursive: true });

		try {
			const manifest = JSON.parse(await fsp.readFile(this.manifestPath, 'utf8'));
			Object.assign(this.meta, manifest);
		} catch (e) {
			log.write('No cache manifest found for %s', this.key);
		}

		this.meta.lastAccess = Date.now();
		this.saveManifest();
	}

	async getFile(file, dir) {
		try {
			const filePath = this.getFilePath(file, dir);

			if (!cacheIntegrity)
				await cacheIntegrityReady();

			const integrityHash = cacheIntegrity[filePath];

			if (typeof integrityHash !== 'string') {
				log.write('Cannot verify integrity of file, rejecting cache (%s)', filePath);
				return null;
			}

			const data = await BufferWrapper.readFile(filePath);
			const dataHash = data.calculateHash('sha1', 'hex');

			if (dataHash !== integrityHash) {
				log.write('Bad integrity for file %s, rejecting cache (%s != %s)', filePath, dataHash, integrityHash);
				return null;
			}

			return data;
		} catch (e) {
			return null;
		}
	}

	getFilePath(file, dir) {
		return path.join(dir || this.cacheDir, file);
	}

	async storeFile(file, data, dir) {
		if (!(data instanceof BufferWrapper))
			throw new Error('Data provided to cache.storeFile() must be of BufferWrapper type.');

		const filePath = this.getFilePath(file, dir);
		if (dir)
			await generics.createDirectory(path.dirname(filePath));

		if (!cacheIntegrity)
			await cacheIntegrityReady();

		const hash = data.calculateHash('sha1', 'hex');
		cacheIntegrity[filePath] = hash;

		await fsp.writeFile(filePath, data.raw);
		core.set_cache_size(core.get_cache_size() + data.byteLength);

		await this.saveCacheIntegrity();
	}

	async saveCacheIntegrity() {
		await fsp.writeFile(constants.CACHE.INTEGRITY_FILE, JSON.stringify(cacheIntegrity), 'utf8');
	}

	async saveManifest() {
		await fsp.writeFile(this.manifestPath, JSON.stringify(this.meta), 'utf8');
	}
}

const init_cache_integrity = async () => {
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
};

// stale cache cleanup after CASC source selection
core.events.once('casc-source-changed', async () => {
	let cacheExpire = Number(core.get_config('cacheExpiry')) || 0;
	cacheExpire *= 24 * 60 * 60 * 1000;

	if (cacheExpire === 0) {
		log.write('WARNING: Cache clean-up has been skipped due to cacheExpiry being %d', cacheExpire);
		return;
	}

	log.write('Running clean-up for stale build caches...');

	let entries;
	try {
		entries = await fsp.readdir(constants.CACHE.DIR_BUILDS, { withFileTypes: true });
	} catch {
		return;
	}
	const ts = Date.now();

	for (const entry of entries) {
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
				deleteEntry = true;
				log.write('Unable to read lastAccess from %s, marking for deletion.', entry.name);
			}
		} catch (e) {
			deleteEntry = true;
			log.write('Unable to read manifest for %s, marking for deletion.', entry.name);
		}

		if (deleteEntry) {
			let deleteSize = await generics.deleteDirectory(entryDir);
			deleteSize -= manifestSize;

			core.set_cache_size(core.get_cache_size() - deleteSize);
		}
	}
});

export { BuildCache, init_cache_integrity, cacheIntegrityReady };
