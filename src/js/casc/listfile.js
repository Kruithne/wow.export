const util = require('util');
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');
const log = require('../log');

const nameLookup = new Map();
const idLookup = new Map();

/**
 * Load listfile for the given build configuration key.
 * Returns the amount of file ID to filename mappings loaded.
 * @param {string} buildConfig
 * @param {BuildCache} cache
 */
const loadListfile = async (buildConfig, cache) => {
	log.write('Loading listfile for build %s', buildConfig);

	idLookup.clear();
	nameLookup.clear();

	//const cacheFile = cache.getFilePath(constants.CACHE.BUILD_LISTFILE);
	let requireDownload = false;
	if (cache.meta.lastListfileUpdate) {
		const ttl = Number(core.view.config.listfileCacheRefresh);
		if (isNaN(ttl) || ttl < 1 || (Date.now() - cache.meta.lastListfileUpdate) > ttl) {
			// Local cache file needs updating (or has invalid manifest entry).
			log.write('Cached listfile for %s is out-of-date (> %d).', buildConfig, ttl);
			requireDownload = true;
		} else {
			// Ensure that the local cache file *actually* exists before relying on it.
			if (!await cache.hasFile(constants.CACHE.BUILD_LISTFILE)) {
				log.write('Listfile for %s is missing despite meta entry. User tamper?', buildConfig);
				requireDownload = true;
			} else {
				log.write('Listfile for %s is cached locally.', buildConfig);
			}
		}
	} else {
		// This listfile has never been updated.
		requireDownload = true;
		log.write('Listfile for %s is not cached, downloading fresh.', buildConfig);
	}

	let data;
	if (requireDownload) {
		let url = String(core.view.config.listfileURL);
		if (typeof url !== 'string')
			throw new Error('Missing/malformed listfileURL in configuration!');

		url = util.format(url, buildConfig);
		data = await generics.downloadFile(url);
		cache.storeFile(constants.CACHE.BUILD_LISTFILE, data);

		cache.meta.lastListfileUpdate = Date.now();
		cache.saveManifest();
	} else {
		data = await cache.getFile(constants.CACHE.BUILD_LISTFILE);
	}

	// Parse all lines in the listfile.
	// Example: 53187;sound/music/citymusic/darnassus/druid grove.mp3
	const lines = data.readLines();
	for (const line of lines) {
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
	}

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
	return nameLookup.get(filename.toLowerCase().replace('\\', '/'));
};

module.exports = { loadListfile, getByID, getByFilename };