/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');
const log = require('../log');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');

const WDCReader = require('../db/WDCReader');

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

	let url = String(core.view.config.listfileURL);
	if (typeof url !== 'string')
		throw new Error('Missing/malformed listfileURL in configuration!');

	// Replace optional buildID wildcard.
	if (url.includes('%s'))
		url = util.format(url, buildConfig);

	idLookup.clear();
	nameLookup.clear();

	let data;
	if (url.startsWith('http')) {
		// Listfile URL is http, check for cache/updates.
		let requireDownload = false;
		const cached = await cache.getFile(constants.CACHE.BUILD_LISTFILE);

		if (cache.meta.lastListfileUpdate) {
			let ttl = Number(core.view.config.listfileCacheRefresh) || 0;
			ttl *= 24 * 60 * 60 * 1000; // Reduce from days to milliseconds.

			if (ttl === 0 || (Date.now() - cache.meta.lastListfileUpdate) > ttl) {
				// Local cache file needs updating (or has invalid manifest entry).
				log.write('Cached listfile for %s is out-of-date (> %d).', buildConfig, ttl);
				requireDownload = true;
			} else {
				// Ensure that the local cache file *actually* exists before relying on it.
				if (cached === null) {
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

		if (requireDownload) {
			try {
				data = await generics.downloadFile(url);
				cache.storeFile(constants.CACHE.BUILD_LISTFILE, data);

				cache.meta.lastListfileUpdate = Date.now();
				cache.saveManifest();
			} catch {
				if (cached === null)
					throw new Error('Failed to download listfile, no cached version for fallback');

				log.write('Failed to download listfile, using cached as redundancy.');
				data = cached;
			}
		} else {
			data = cached;
		}
	} else {
		// User has configured a local listfile location.
		log.write('Loading user-defined local listfile: %s', url);
		data = await BufferWrapper.readFile(url);
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

		const fileName = tokens[1].toLowerCase();
		idLookup.set(fileDataID, fileName);
		nameLookup.set(fileName, fileDataID);
	}

	let unknownCount = 0;
	unknownCount += await loadIDTable('DBFilesClient/ModelFileData.db2', '.m2');
	unknownCount += await loadIDTable('DBFilesClient/TextureFileData.db2', '.blp');

	log.write('%d listfile entries loaded (%d unknown entries)', idLookup.size, unknownCount);
	return idLookup.size;
}

/**
 * Load file IDs from a data table.
 * @param {string} tableFile 
 * @param {string} ext 
 */
const loadIDTable = async (tableFile, ext) => {
	let loadCount = 0;
	const table = new WDCReader(tableFile);
	await table.parse();

	for (const row of table.rows.values()) {
		const fileDataID = row.FileDataID;
		if (!idLookup.has(fileDataID)) {
			const fileName = 'unknown_' + fileDataID + ext;
			idLookup.set(fileDataID, fileName);
			nameLookup.set(fileName, fileDataID);
			loadCount++;
		}
	}

	return loadCount;
};

/**
 * Return an array of filenames ending with the given extension(s).
 * @param {string|Array} exts 
 */
const getFilenamesByExtension = (exts) => {
	// Box into an array for reduced code.
	if (!Array.isArray(exts))
		exts = [exts];

	const entries = [];
	for (const filename of idLookup.values()) {
		for (const ext of exts) {
			if (Array.isArray(ext)) {
				if (filename.endsWith(ext[0]) && !filename.match(ext[1])) {
					entries.push(filename);
					continue;
				}
			} else {
				if (filename.endsWith(ext)) {
					entries.push(filename);
					continue;
				}
			}
		}
	}

	entries.sort();
	return entries;
};

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
	let lookup = nameLookup.get(filename.toLowerCase().replace(/\\/g, '/'));
	
	// In the rare occasion we have a reference to an MDL/MDX file and it fails
	// to resolve (as expected), attempt to resolve the M2 of the same name.
	if (!lookup && (filename.endsWith('.mdl') || filename.endsWith('mdx')))
		lookup = nameLookup.get(ExportHelper.replaceExtension(filename, '.m2').replace(/\\/g, '/'));

	return lookup;
};

module.exports = { loadListfile, getByID, getByFilename, getFilenamesByExtension };