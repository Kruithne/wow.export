/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');
const log = require('../log');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const BuildCache = require('./build-cache');

const WDCReader = require('../db/WDCReader');
const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBModelFileData = require('../db/caches/DBModelFileData');

const nameLookup = new Map();
const idLookup = new Map();

let loaded = false;

let preloadedIdLookup = new Map();
let preloadedNameLookup = new Map();
let preloadTextures = [];
let preloadSounds = [];
let preloadVideos = [];
let preloadText = [];
let preloadModels = [];
let isPreloaded = false;
let preloadPromise = null;

/**
 * Internal implementation of preload logic.
 * @returns {Promise<boolean>} Returns true if preloading succeeded, false otherwise.
 */
const _doPreload = async () => {
	try {
		log.write('Preloading master listfile...');

		let url = String(core.view.config.listfileURL);
		if (typeof url !== 'string')
			throw new Error('Missing/malformed listfileURL in configuration!');

		const cache = new BuildCache('listfile');
		await cache.init();

		preloadedIdLookup.clear();
		preloadedNameLookup.clear();
		isPreloaded = false;

		let data;
		if (url.startsWith('http')) {
			// Listfile URL is http, check for cache/updates (same logic as loadListfile)
			let requireDownload = false;
			const cached = await cache.getFile(constants.CACHE.BUILD_LISTFILE);

			if (cache.meta.lastListfileUpdate) {
				let ttl = Number(core.view.config.listfileCacheRefresh) || 0;
				ttl *= 24 * 60 * 60 * 1000; // Reduce from days to milliseconds.

				if (ttl === 0 || (Date.now() - cache.meta.lastListfileUpdate) > ttl) {
					// Local cache file needs updating (or has invalid manifest entry).
					log.write('Cached listfile is out-of-date (> %d).', ttl);
					requireDownload = true;
				} else {
					// Ensure that the local cache file *actually* exists before relying on it.
					if (cached === null) {
						log.write('Listfile is missing despite meta entry. User tamper?');
						requireDownload = true;
					} else {
						log.write('Listfile is cached locally.');
					}
				}
			} else {
				// This listfile has never been updated.
				requireDownload = true;
				log.write('Listfile is not cached, downloading fresh.');
			}

			if (requireDownload) {
				try {
					let fallback_url = String(core.view.config.listfileFallbackURL);
					// Remove %s placeholder since we don't use buildConfig for master listfile
					fallback_url = fallback_url.replace('%s', '');
					
					data = await generics.downloadFile([url, fallback_url]);

					cache.storeFile(constants.CACHE.BUILD_LISTFILE, data);
					cache.meta.lastListfileUpdate = Date.now();
					cache.saveManifest();
				} catch (e) {
					if (cached === null) {
						log.write('Failed to download listfile during preload, no cached version for fallback: %s', e.message);
						return false;
					}

					log.write('Failed to download listfile during preload, using cached version: %s', e.message);
					data = cached;
				}
			} else {
				data = cached;
			}
		} else {
			// User has configured a local listfile location
			log.write('Preloading user-defined local listfile: %s', url);
			data = await BufferWrapper.readFile(url);
		}

		const lines = data.readLines();
		log.write('Processing %d listfile lines in chunks...', lines.length);
		
		await generics.batchWork('listfile parsing', lines, (line, index) => {
			if (line.length === 0)
				return;

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
			preloadedIdLookup.set(fileDataID, fileName);
			preloadedNameLookup.set(fileName, fileDataID);
		}, 1000);

		if (preloadedIdLookup.size === 0) {
			log.write('No entries found in preloaded listfile');
			return false;
		}

		// Pre-filter into different extension types (unformatted fileDataID arrays)
		preloadTextures = await getFileDataIDsByExtension('.blp', 'filtering textures');
		preloadSounds = await getFileDataIDsByExtension(['.ogg', '.mp3', '.unk_sound'], 'filtering sounds');
		preloadVideos = await getFileDataIDsByExtension('.avi', 'filtering videos');
		preloadText = await getFileDataIDsByExtension(['.txt', '.lua', '.xml', '.sbt', '.wtf', '.htm', '.toc', '.xsd'], 'filtering text files');
		preloadModels = await getPreloadedModelFormats();
		
		isPreloaded = true;
		log.write('Preloaded %d listfile entries and filtered by extensions', preloadedIdLookup.size);
		return true;
	} catch (e) {
		log.write('Error during listfile preload: %s', e.message);
		isPreloaded = false;
		return false;
	}
};

/**
 * Preload the master listfile and filter it into different extension types.
 * This can be called early in the application startup before any user selection.
 * Multiple calls to this function will return the same promise.
 * @returns {Promise<boolean>} Returns true if preloading succeeded, false otherwise.
 */
const preload = async () => {
	if (preloadPromise)
		return preloadPromise;
	
	if (isPreloaded)
		return true;
	
	preloadPromise = _doPreload();
	return preloadPromise;
};

/**
 * Ensure listfile is preloaded and ready for use.
 * This should be called during the loading process before accessing listfile data.
 * @returns {Promise<boolean>} Returns true if preparation succeeded, false otherwise.
 */
const prepareListfile = async () => {
	if (isPreloaded)
		return true;
	
	if (preloadPromise) {
		log.write('Waiting for listfile preload to complete...');
		return await preloadPromise;
	}
	
	log.write('Starting listfile preload...');
	return await preload();
};

/**
 * Helper function to get fileDataIDs by extension from preloaded data.
 * @param {string|Array} exts 
 * @param {string} name - Name for logging purposes
 * @returns {Promise<Array>} Array of fileDataIDs (unformatted)
 */
const getFileDataIDsByExtension = async (exts, name) => {
	if (!Array.isArray(exts))
		exts = [exts];

	const entries = [];
	const entriesArray = Array.from(preloadedIdLookup.entries());

	await generics.batchWork(name, entriesArray, ([fileDataID, filename]) => {
		for (const ext of exts) {
			if (Array.isArray(ext)) {
				if (filename.endsWith(ext[0]) && !filename.match(ext[1])) {
					entries.push(fileDataID);
					break;
				}
			} else {
				if (filename.endsWith(ext)) {
					entries.push(fileDataID);
					break;
				}
			}
		}
	}, 1000);

	return entries;
};

/**
 * Helper function to get model formats from preloaded data.
 * @returns {Promise<Array>} Array of fileDataIDs (unformatted)
 */
const getPreloadedModelFormats = async () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM3)
		modelExt.push('.m3');

	if (core.view.config.modelsShowM2)
		modelExt.push('.m2');
	
	if (core.view.config.modelsShowWMO)
		modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

	return await getFileDataIDsByExtension(modelExt, 'filtering models');
};

/**
 * Apply preloaded listfile data filtered by rootEntries.
 * This allows using the preloaded data instead of re-downloading and parsing.
 * @param {Map} rootEntries Map of root entries to filter by
 * @returns {number} Number of entries applied, or 0 if preload not available/failed
 */
const applyPreload = (rootEntries) => {
	if (!isPreloaded) {
		log.write('No preloaded listfile available, falling back to normal loading');
		return 0;
	}

	try {
		log.write('Applying preloaded listfile data...');
		
		// Clear current data
		idLookup.clear();
		nameLookup.clear();

		// Apply preloaded entries filtered by rootEntries
		let appliedCount = 0;
		for (const [fileDataID, fileName] of preloadedIdLookup.entries()) {
			if (rootEntries.has(fileDataID)) {
				idLookup.set(fileDataID, fileName);
				nameLookup.set(fileName, fileDataID);
				appliedCount++;
			}
		}

		if (appliedCount === 0) {
			log.write('No preloaded entries matched rootEntries');
			return 0;
		}

		const filterAndFormat = (fileDataIDs) => {
			const result = formatEntries(fileDataIDs.filter(id => rootEntries.has(id)));
			fileDataIDs.length = 0; // Free memory
			return result;
		};

		core.view.listfileTextures = filterAndFormat(preloadTextures);
		core.view.listfileSounds = filterAndFormat(preloadSounds);
		core.view.listfileVideos = filterAndFormat(preloadVideos);
		core.view.listfileText = filterAndFormat(preloadText);
		core.view.listfileModels = filterAndFormat(preloadModels);

		loaded = true;
		log.write('Applied %d preloaded listfile entries', appliedCount);
	} catch (e) {
		log.write('Error applying preloaded listfile: %s', e.message);
	}
};


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

const ingestIdentifiedFiles = (entries) => {
	for (const [fileDataID, ext] of entries) {
		const fileName = 'unknown/' + fileDataID + ext;
		idLookup.set(fileDataID, fileName);
		nameLookup.set(fileName, fileDataID);
	}
	
	core.events.emit('listfile-needs-updating');
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
 * @param {string} [ext]
 * @returns {string}
 */
const getByIDOrUnknown = (id, ext = '') => {
	return idLookup.get(id) ?? formatUnknownFile(id, ext);
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

/**
 * Adds an entry to the listfile.
 * @returns {void}
 */
const addEntry = (fileDataID, fileName) => {
	idLookup.set(fileDataID, fileName);
	nameLookup.set(fileName, fileDataID);
};

module.exports = {
	loadUnknowns,
	preload,
	prepareListfile,
	applyPreload,
	getByID,
	getByFilename,
	getFullListfile,
	getFilenamesByExtension,
	getFilteredEntries,
	getByIDOrUnknown,
	stripFileEntry,
	formatEntries,
	formatUnknownFile,
	ingestIdentifiedFiles,
	isLoaded,
	addEntry
};