const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const log = require('../log');
const config = require('../config');
const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');

class BuildCache {
	/**
	 * Construct a new BuildCache instance.
	 * @param {string} key 
	 */
	constructor(key) {
		this.key = key;
		this.meta = {};

		this.cacheDir = path.join(constants.CACHE.BUILD, key);
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
	 * @param {string} file 
	 */
	async getFile(file) {
		try {
			return await fsp.readFile(this.getFilePath(file));
		} catch (e) {
			return null;
		}
	}

	/**
	 * Get a direct path to a cached file.
	 * Does not guarentee existence. Use hasFile() first to check.
	 * @param {string} file 
	 */
	getFilePath(file) {
		return path.join(this.cacheDir, file);
	}

	/**
	 * Check if this build cache has a file without loading it.
	 * Returns true if the file exists in cache, otherwise false.
	 */
	async hasFile(file) {
		try {
			await fsp.access(this.getFilePath(file));
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Store a file in this build cache.
	 * @param {string} file 
	 * @param {mixed} data 
	 */
	async storeFile(file, data) {
		await fsp.writeFile(this.getFilePath(file), data);
	}

	/**
	 * Save the manifest for this build cache.
	 */
	async saveManifest() {
		await fsp.writeFile(this.manifestPath, JSON.stringify(this.meta), 'utf8');
	}
}

// Run cache clean-up once a CASC source has been selected.
// We delay this until here so that we don't potentially mark
// a build as stale and delete it right before the user requests it.
core.events.once('casc-source-changed', async () => {
	const cacheExpire = config.getNumber('listfileCacheExpiry');

	// If user sets listfileCacheExpiry to 0 in the configuration, we completely
	// skip the clean-up process. This is generally considered a bad idea.
	if (isNaN(cacheExpire) || cacheExpire <= 0) {
		log.write('WARNING: Cache clean-up has been skipped due to listfileCacheExpiry being %s', cacheExpire);
		return;
	}

	log.write('Running clean-up for stale build caches...');
	const entries = await fsp.readdir(constants.CACHE.BUILD, { withFileTypes: true });
	const ts = Date.now();

	for (const entry of entries) {
		// We only care about directories with MD5 names.
		// There shouldn't be anything else in there anyway.
		if (!entry.isDirectory() || entry.name.length !== 32)
			continue;

		let deleteEntry = false;
		const entryDir = path.join(constants.CACHE.BUILD, entry.name);
		const entryManifest = path.join(entryDir, constants.CACHE.BUILD_MANIFEST);

		try {
			const manifest = JSON.parse(await fsp.readFile(entryManifest, 'utf8'));
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

		if (deleteEntry)
			await generics.deleteDirectory(entryDir);
	}
});

module.exports = BuildCache;