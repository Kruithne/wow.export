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
const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBModelFileData = require('../db/caches/DBModelFileData');

const nameLookup = new Map();
const idLookup = new Map();

let loaded = false;

/**
 * Load listfile for the given build configuration key.
 * Returns the amount of file ID to filename mappings loaded.
 * @param {string} buildConfig
 * @param {BuildCache} cache
 * @param {Map} rootEntries
 */
const loadListfile = async (buildConfig, cache, rootEntries) => {
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

		if (rootEntries.has(fileDataID))
		{
			const fileName = tokens[1].toLowerCase();
			idLookup.set(fileDataID, fileName);
			nameLookup.set(fileName, fileDataID);
		}
	}

	loaded = true;
	log.write('%d listfile entries loaded', idLookup.size);
	return idLookup.size;
}

/**
 * Load unknown files from TextureFileData/ModelFileData.
 * Must be called after DBTextureFileData/DBModelFileData have loaded.
 */
const loadUnknowns = async () => {
	const unkBlp = await loadIDTable(DBTextureFileData.getFileDataIDs(), '.blp');
	const unkM2 = await loadIDTable(DBModelFileData.getFileDataIDs(), '.m2');

	log.write('Added %d unknown BLP textures from TextureFileData to listfile', unkBlp);
	log.write('Added %d unknown M2 models from ModelFileData to listfile', unkM2);
	
	// Load unknown sounds from SoundKitEntry table.
	const soundKitEntries = new WDCReader('DBFilesClient/SoundKitEntry.db2');
	await soundKitEntries.parse();
	
	let unknownCount = 0;
	for (const entry of soundKitEntries.getAllRows().values()) {
		if (!idLookup.has(entry.FileDataID)) {
			// List unknown sound files using the .unk_sound extension. Files will be
			// dynamically checked upon export and given the correct extension.
			const fileName = 'unknown/' + entry.FileDataID + '.unk_sound';
			idLookup.set(entry.FileDataID, fileName);
			nameLookup.set(fileName, entry.FileDataID);
			unknownCount++;
		}
	}

	log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknownCount);
};

/**
 * Load file IDs from a data table.
 * @param {Set} ids
 * @param {string} ext 
 */
const loadIDTable = async (ids, ext) => {
	let loadCount = 0;

	for (const fileDataID of ids) {
		if (!idLookup.has(fileDataID)) {
			const fileName = 'unknown/' + fileDataID + ext;
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
 * @returns {Array}
 */
const getFilenamesByExtension = (exts) => {
	// Box into an array for reduced code.
	if (!Array.isArray(exts))
		exts = [exts];

	let entries = [];

	for (const [fileDataID, filename] of idLookup.entries()) {
		for (const ext of exts) {
			if (Array.isArray(ext)) {
				if (filename.endsWith(ext[0]) && !filename.match(ext[1])) {
					entries.push(fileDataID);
					continue;
				}
			} else {
				if (filename.endsWith(ext)) {
					entries.push(fileDataID);
					continue;
				}
			}
		}
	}

	return formatEntries(entries);
};

/**
 * Sort and format listfile entries for file list display.
 * @param {Array} entries 
 * @returns {Array}
 */
const formatEntries = (entries) => {
	// If sorting by ID, perform the sort while the array is only IDs.
	if (core.view.config.listfileSortByID)
		entries.sort((a, b) => a - b);

	if (core.view.config.listfileShowFileDataIDs)
		entries = entries.map(e => getByIDOrUnknown(e) + ' [' + e + ']');
	else
		entries = entries.map(e => getByIDOrUnknown(e));

	// If sorting by name, sort now that the filenames have been added.
	if (!core.view.config.listfileSortByID)
		entries.sort();

	return entries;
};

/**
 * Returns a full listfile, sorted and formatted.
 * @returns {Array}
 */
const getFullListfile = () => {
	return formatEntries([...idLookup.keys()]);
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
 * Get a filename from a given file data ID or format it as an unknown file.
 * @param {number} id 
 * @returns {string}
 */
const getByIDOrUnknown = (id) => {
	return idLookup.get(id) ?? formatUnknownFile(id);
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

/**
 * Returns an array of listfile entries filtered by the given search term.
 * @param {string|RegExp} search 
 * @returns {Array.<object>}
 */
const getFilteredEntries = (search) => {
	const results = [];
	const isRegExp = search instanceof RegExp;

	for (const [fileDataID, fileName] of idLookup.entries()) {
		if (isRegExp ? fileName.match(search) : fileName.includes(search))
			results.push({ fileDataID, fileName });
	}

	return results;
};

/**
 * Strips a prefixed file ID from a listfile entry.
 * @param {string} entry 
 * @returns {string}
 */
const stripFileEntry = (entry) => {
	if (typeof entry === 'string' && entry.includes(' ['))
		return entry.substring(0, entry.lastIndexOf(' ['));

	return entry;
};

/**
 * Returns a file path for an unknown fileDataID.
 * @param {number} fileDataID 
 * @param {string} [ext]
 */
const formatUnknownFile = (fileDataID, ext = '') => {
	return 'unknown/' + fileDataID + ext;
};

/**
 * Returns true if a listfile has been loaded.
 * @returns {boolean}
 */
const isLoaded = () => {
	return loaded;
};

module.exports = {
	loadListfile,
	loadUnknowns,
	getByID,
	getByFilename,
	getFullListfile,
	getFilenamesByExtension,
	getFilteredEntries,
	stripFileEntry,
	formatEntries,
	formatUnknownFile,
	isLoaded
};