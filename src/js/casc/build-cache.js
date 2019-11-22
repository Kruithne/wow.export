const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const log = require('../log');
const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');
const BufferWrapper = require('../buffer');

class BuildCache {
	/**
	 * Construct a new BuildCache instance.
	 * @param {string} key 
	 */
	constructor(key) {
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
	 * @param {string} file File path relative to build cache.
	 * @param {string} dir Optional override directory.
	 */
	async getFile(file, dir) {
		try {
			return await BufferWrapper.readFile(this.getFilePath(file, dir));
		} catch (e) {
			return null;
		}
	}

	/**
	 * Get a direct path to a cached file.
	 * Does not guarentee existence. Use hasFile() first to check.
	 * @param {string} file File path relative to build cache.
	 * @param {string} dir Optional override directory.
	 */
	getFilePath(file, dir) {
		return path.join(dir || this.cacheDir, file);
	}

	/**
	 * Check if this build cache has a file without loading it.
	 * Returns true if the file exists in cache, otherwise false.
	 * @param {string} file File path relative to build cache.
	 * @param {string} dir Optional override dir.
	 */
	async hasFile(file, dir) {
		try {
			await fsp.access(this.getFilePath(file, dir));
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Store a file in this build cache.
	 * @param {string} file File path relative to build cache.
	 * @param {mixed} data Data to store in the file.
	 * @param {string} dir Optional override directory.
	 */
	async storeFile(file, data, dir) {
		if (data instanceof BufferWrapper)
			data = data.raw;

		const filePath = this.getFilePath(file, dir);
		if (dir)
			await generics.createDirectory(path.dirname(filePath));

		await fsp.writeFile(filePath, data);
		core.view.cacheSize += data.byteLength;
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

module.exports = BuildCache;