const path = require('path');
const util = require('util');
const fs = require('fs');
const fsp = fs.promises;
const generics = require('../generics');
const constants = require('../constants');
const config = require('../config');
const log = require('../log');

const cacheManifest = new Map();
const nameLookup = new Map();
const idLookup = new Map();

/**
 * Initialize the listfile reading interface.
 * This ensures cache directories are created and expired cache files
 * are removed. It does not download/parse listfiles here.
 */
const initialize = async () => {
	log.write('Listfile initialization started');

	// Ensure the cache directory exists.
	await generics.createDirectory(constants.LISTFILE.CACHE_DIR);

	// Load pre-existing listfile cache manifest from disk.
	try {
		const json = JSON.parse(await fsp.readFile(constants.LISTFILE.CACHE_MANIFEST, 'utf8'));
		for (const [key, node] of Object.entries(json))
			cacheManifest.set(key, node);
	} catch (e) {
		// Manifest won't exist on fresh installs, not fatal.
		log.write('Invalid local listfile cache manifest (%s)', e.message);
	}

	// Clean-up any expired cache files.
	const cacheExpire = config.getNumber('listfileCacheExpiry');
	if (!isNaN(cacheExpire) && cacheExpire > 0) {
		const ts = Date.now();
		let deleteCount = 0;
		for (const [key, node] of cacheManifest.entries()) {
			if (ts - node.lastAccess > cacheExpire) {
				const cacheFile = path.join(constants.LISTFILE.CACHE_DIR, key);
				deleteCount++;

				try {
					await fsp.unlink(cacheFile);
				} catch (e) {
					// Potentially doesn't exist? Likely caused by user tinkering. Not fatal.
					log.write('Error cleaning cache file: %s (%s)', cacheFile, e.message);
				}
			}
		}

		if (deleteCount > 0)
			log.write('Deleted %d expired local listfile cache files', deleteCount);
	} else {
		log.write('Clean-up of local listfile cached has been skipped: listfileCacheExpiry = %s', cacheExpire);
	}
};

/**
 * Persist the cache manifest to disk.
 */
const saveManifest = async () => {
	const comp = {};

	for (const [key, node] of cacheManifest.entries())
		comp[key] = node;

	await fsp.writeFile(constants.LISTFILE.CACHE_MANIFEST, JSON.stringify(comp));
};

/**
 * Load listfile for the given build configuration key.
 * Returns the amount of file ID to filename mappings loaded.
 * @param {string} buildConfig
 */
const loadListfile = async (buildConfig) => {
	log.write('Loading listfile for build %s', buildConfig);

	idLookup.clear();
	nameLookup.clear();

	const cacheFile = path.join(constants.LISTFILE.CACHE_DIR, buildConfig);
	let cacheMeta = cacheManifest.get(buildConfig);
	let requireDownload = !cacheMeta;

	if (cacheMeta) {
		const ttl = config.getNumber('listfileCacheRefresh');
		if (isNaN(ttl) || ttl < 1 || (Date.now() - cacheMeta.lastUpdate) > ttl) {
			// Local cache file needs updating (or has invalid manifest entry).
			log.write('Local listfile cache file is out-of-date (> %d).', ttl);
			requireDownload = true;
		} else {
			// Ensure that the local cache file *actually* exists before relying on it.
			const exists = await generics.fileExists(cacheFile);
			if (!exists) {
				log.write('Local listfile cache is missing; broken manifest entry?');
				requireDownload = true;
			} else {
				log.write('Listfile %s is cached locally', buildConfig);
			}
		}
	} else {
		cacheMeta = {};
		cacheManifest.set(buildConfig, cacheMeta);
		log.write('No manifest entry found for listfile.');
	}

	if (requireDownload) {
		let url = config.getString('listfileURL');
		if (url === null)
			throw new Error('Missing listfileURL in configuration!');

		url = util.format(url, buildConfig);
		await generics.downloadFile(url, cacheFile);

		cacheMeta.lastUpdate = Date.now();
	}

	cacheMeta.lastAccess = Date.now();
	saveManifest(); // Don't need to wait for this to resolve.

	// Parse all lines in the listfile.
	// Example: 53187;sound/music/citymusic/darnassus/druid grove.mp3
	await generics.readFileLines(cacheFile, line => {
		const tokens = line.split(';');

		if (tokens.length !== 2) {
			log.write('Invalid listfile line (token count): %s', line);
			return;
		}

		const fileDataID = Number(tokens[0]);
		if (isNaN(fileDataID)) {
			log.write('Invalid listfile line (non-numerical ID): %s', line);
			return;
		}

		idLookup.set(fileDataID, tokens[1]);
		nameLookup.set(tokens[1], fileDataID);
	});

	log.write('%d listfile entries loaded', idLookup.size);
	return idLookup.size;
}

/**
 * Get a filename from a given file data ID.
 * @param {number} id 
 * @returns {string|undefined}
 */
const getByID = (id) => {
	return idLookup.get(id);
};

/**
 * Get a file data ID by a given file name.
 * @param {string} filename
 * @returns {number|undefined} 
 */
const getByFilename = (filename) => {
	return nameLookup.get(filename);
};

module.exports = { initialize, loadListfile, getByID, getByFilename };