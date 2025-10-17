/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const path = require('path');
const util = require('util');
const fsp = require('fs').promises;
const generics = require('../generics');
const constants = require('../constants');
const core = require('../core');
const log = require('../log');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const mmap = require(path.join(process.cwd(), 'mmap.node'));
const hash_xxhash64 = require('../hashing/xxhash64');

const DBTextureFileData = require('../db/caches/DBTextureFileData');
const DBModelFileData = require('../db/caches/DBModelFileData');

const BIN_LF_COMPONENTS = {
	ID_INDEX: 'listfile-id-index.dat',
	STRINGS: 'listfile-strings.dat',
	TREE_INDEX: 'listfile-tree-index.dat',
	TREE_NODES: 'listfile-tree-nodes.dat'
};

const LISTFILE_FLAGS = {
	TEXTURE: 0x01,
	SOUND: 0x02,
	MODEL: 0x04,
	VIDEO: 0x08,
	TEXT: 0x10
};

// these are populated by the legacy text-based listfile format
const legacy_name_lookup = new Map();
const legacy_id_lookup = new Map();

let loaded = false;

// legacy format only
let preloadedIdLookup = new Map();
let preloadedNameLookup = new Map();

// binary format only
let binary_id_to_offset = new Map();
let binary_id_to_flags = new Map();

let binary_strings_mmap = null;
let binary_tree_nodes_mmap = null;
let binary_tree_index_mmap = null;

let is_binary_mode = false;

let preload_textures = [];
let preload_sounds = [];
let preload_videos = [];
let preload_text = [];
let preload_models = [];

let is_preloaded = false;
let preload_promise = null;

const listfile_check_cache_expiry = (last_modified) => {
	if (last_modified > 0) {
		let ttl = Number(core.view.config.listfileCacheRefresh) || 0;
		ttl *= 24 * 60 * 60 * 1000; // Reduce from days to milliseconds.
		
		if (ttl === 0 || (Date.now() - last_modified) > ttl) {
			log.write('Cached listfile is out-of-date (> %d).', ttl);
			return true;
		}
		
		log.write('Listfile is cached locally.');
		return false;
	}
	
	log.write('Listfile is not cached, downloading fresh.');
	return true;
};

// region binary
const listfile_preload_binary = async () => {
	try {
		log.write('Downloading binary listfile format...');
		
		const bin_url = String(core.view.config.listfileBinarySource);
		if (typeof bin_url !== 'string')
			throw new Error('Missing/malformed listfileBinarySource in configuration!');
		
		await fsp.mkdir(constants.CACHE.DIR_LISTFILE, { recursive: true });
		let last_modified = 0;
		
		try {
			const idx_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.ID_INDEX);
			last_modified = (await fsp.stat(idx_file)).mtime.getTime();
		} catch (e) {
			// No cached files.
		}
		
		if (listfile_check_cache_expiry(last_modified)) {
			for (const file of Object.values(BIN_LF_COMPONENTS)) {
				const file_url = util.format(bin_url, file);
				const cache_file = path.join(constants.CACHE.DIR_LISTFILE, file);
				
				try {
					log.write('Downloading binary listfile component: %s', file);
					const data = await generics.downloadFile([file_url]);
					await fsp.writeFile(cache_file, data.raw);
				} catch (e) {
					log.write('Failed to download binary listfile component (%s): %s)', file, e.message);
				}
			}
		}
		
		// load ID index into memory
		log.write('Loading binary listfile ID index into memory...');
		const idx_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.ID_INDEX);
		const idx_buffer = await BufferWrapper.readFile(idx_file);
		
		binary_id_to_offset.clear();
		binary_id_to_flags.clear();
		
		const entry_count = idx_buffer.byteLength / 9;
		for (let i = 0; i < entry_count; i++) {
			const id = idx_buffer.readUInt32BE();
			const string_offset = idx_buffer.readUInt32BE();
			const flags = idx_buffer.readUInt8();
			
			binary_id_to_offset.set(id, string_offset);
			binary_id_to_flags.set(id, flags);
		}
		
		log.write('Loaded %d binary listfile entries', binary_id_to_offset.size);
		
		// build preload arrays by filtering IDs based on flags
		preload_textures = [];
		preload_sounds = [];
		preload_models = [];
		preload_videos = [];
		preload_text = [];
		
		for (const [id, flags] of binary_id_to_flags.entries()) {
			if (flags & LISTFILE_FLAGS.TEXTURE)
				preload_textures.push(id);
			else if (flags & LISTFILE_FLAGS.SOUND)
				preload_sounds.push(id);
			else if (flags & LISTFILE_FLAGS.MODEL)
				preload_models.push(id);
			else if (flags & LISTFILE_FLAGS.VIDEO)
				preload_videos.push(id);
			else if (flags & LISTFILE_FLAGS.TEXT)
				preload_text.push(id);
		}
		
		log.write('Filtered binary listfile: %d textures, %d sounds, %d models, %d videos, %d text',
			preload_textures.length, preload_sounds.length, preload_models.length, preload_videos.length, preload_text.length);
			
		// memory-map strings file
		try {
			binary_strings_mmap = new mmap.MmapObject();
			const strings_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.STRINGS);
			log.write('Mapping strings file: %s', strings_file);
			if (!binary_strings_mmap.mapFile(strings_file, { protection: 'readonly' }))
				throw new Error('Failed to map strings file: ' + binary_strings_mmap.lastError);
		} catch (e) {
			log.write('Error mapping strings file: %s', e.message);
			throw e;
		}
		
		// memory-map tree nodes file
		try {
			binary_tree_nodes_mmap = new mmap.MmapObject();
			const tree_nodes_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.TREE_NODES);
			log.write('Mapping tree nodes file: %s', tree_nodes_file);
			if (!binary_tree_nodes_mmap.mapFile(tree_nodes_file, { protection: 'readonly' }))
				throw new Error('Failed to map tree nodes file: ' + binary_tree_nodes_mmap.lastError);
		} catch (e) {
			log.write('Error mapping tree nodes file: %s', e.message);
			throw e;
		}
		
		// memory-map tree index file
		try {
			binary_tree_index_mmap = new mmap.MmapObject();
			const tree_index_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.TREE_INDEX);
			log.write('Mapping tree index file: %s', tree_index_file);
			if (!binary_tree_index_mmap.mapFile(tree_index_file, { protection: 'readonly' }))
				throw new Error('Failed to map tree index file: ' + binary_tree_index_mmap.lastError);
		} catch (e) {
			log.write('Error mapping tree index file: %s', e.message);
			throw e;
		}
		
		log.write('Binary listfile preload complete');
		is_binary_mode = true;
		return true;
	} catch (e) {
		log.write('Error downloading binary listfile: %s', e.message);
		return false;
	}
};
	
const listfile_binary_find_component_child = (node_ofs, component_name) => {
	const target_hash = hash_xxhash64(component_name);

	const node_data = binary_tree_nodes_mmap.data;
	const view = new DataView(node_data.buffer, node_data.byteOffset + node_ofs);

	const child_count = view.getUint32(0, false);
	const child_entries_ofs = 9;

	// binary search through child entries
	let left = 0;
	let right = child_count - 1;

	while (left <= right) {
		const mid = Math.floor((left + right) / 2);
		const entry_ofs = child_entries_ofs + (mid * 12);

		const child_hash = view.getBigUint64(entry_ofs, false);
		if (child_hash === target_hash)
			return view.getUint32(entry_ofs + 8, false);

		if (child_hash < target_hash)
			left = mid + 1;
		else
			right = mid - 1;
	}

	return -1;
};

const listfile_binary_find_file = (node_ofs, filename) => {
	const node_data = binary_tree_nodes_mmap.data;
	const view = new DataView(node_data.buffer, node_data.byteOffset + node_ofs);

	const child_count = view.getUint32(0, false);
	const file_count = view.getUint32(4, false);
	const is_large_dir = view.getUint8(8) === 1;

	if (file_count === 0)
		return undefined;

	// calculate offset where file entries start (after child entries)
	const file_entries_start = 9 + (child_count * 12);

	if (is_large_dir) {
		// large dir: binary search by filename hash
		const target_hash = hash_xxhash64(filename);

		let left = 0;
		let right = file_count - 1;

		while (left <= right) {
			const mid = Math.floor((left + right) / 2);
			const entry_ofs = file_entries_start + (mid * 12);

			const file_hash = view.getBigUint64(entry_ofs, false);

			if (file_hash === target_hash)
				return view.getUint32(entry_ofs + 8, false);

			if (file_hash < target_hash)
				left = mid + 1;
			else
				right = mid - 1;
		}
	} else {
		// small dir: linear scan through filename entries
		let pos = file_entries_start;
		for (let i = 0; i < file_count; i++) {
			const filename_len = view.getUint16(pos, false);
			pos += 2;

			const filename_bytes = node_data.subarray(node_ofs + pos, node_ofs + pos + filename_len);
			const entry_filename = Buffer.from(filename_bytes).toString('utf8');
			pos += filename_len;

			const file_id = view.getUint32(pos, false);
			pos += 4;

			if (entry_filename === filename)
				return file_id;
		}
	}

	return undefined;
};
// endregion
	
// region legacy
const listfile_preload_legacy = async () => {
	try {
		let url = String(core.view.config.listfileURL);
		if (typeof url !== 'string')
			throw new Error('Missing/malformed listfileURL in configuration!');
		
		// Ensure listfile cache directory exists
		await fsp.mkdir(constants.CACHE.DIR_LISTFILE, { recursive: true });
		
		const cache_file = path.join(constants.CACHE.DIR_LISTFILE, constants.CACHE.LISTFILE_DATA);
		
		preloadedIdLookup.clear();
		preloadedNameLookup.clear();
		
		let data;
		if (url.startsWith('http')) {
			let cached = null;
			let last_modified = 0;
			
			try {
				cached = await BufferWrapper.readFile(cache_file);
				last_modified = (await fsp.stat(cache_file)).mtime.getTime();
			} catch (e) {
				// No cached file
			}
			
			if (listfile_check_cache_expiry(last_modified)) {
				try {
					let fallback_url = String(core.view.config.listfileFallbackURL);
					
					// Remove %s placeholder since we don't use buildConfig for master listfile
					fallback_url = fallback_url.replace('%s', '');
					
					data = await generics.downloadFile([url, fallback_url]);
					
					// Store the downloaded data (file modification time will be set automatically)
					await fsp.writeFile(cache_file, data.raw);
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
		preload_textures = await getFileDataIDsByExtension('.blp', 'filtering textures');
		preload_sounds = await getFileDataIDsByExtension(['.ogg', '.mp3', '.unk_sound'], 'filtering sounds');
		preload_videos = await getFileDataIDsByExtension('.avi', 'filtering videos');
		preload_text = await getFileDataIDsByExtension(['.txt', '.lua', '.xml', '.sbt', '.wtf', '.htm', '.toc', '.xsd'], 'filtering text files');
		preload_models = await getFileDataIDsByExtension(['.m2', '.wmo', '.m3']);
		
		is_preloaded = true;
		log.write('Preloaded %d listfile entries and filtered by extensions', preloadedIdLookup.size);
		return true;
	} catch (e) {
		log.write('Error during listfile preload: %s', e.message);
		is_preloaded = false;
		return false;
	}
};
// endregion

const listfile_preload = async () => {
	is_preloaded = false;
	log.write('Preloading master listfile...');
	
	if (core.view.config.enableBinaryListfile) {
		if (await listfile_preload_binary()) {
			log.write('Binary listfile loaded successfully'); // todo: some info?
			is_preloaded = true; // todo: is this right?
			return true;
		}
		
		log.write('Failed to download binary listfile, falling back to legacy format');
	}
	
	await listfile_preload_legacy();
};
	
// region api
const preload = async () => {
	if (preload_promise)
		return preload_promise;
	
	if (is_preloaded)
		return true;
	
	preload_promise = listfile_preload();
	return preload_promise;
};

const prepareListfile = async () => {
	if (is_preloaded)
		return true;
	
	if (preload_promise) {
		log.write('Waiting for listfile preload to complete...');
		return await preload_promise;
	}
	
	log.write('Starting listfile preload...');
	return await preload();
};

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

const applyPreload = (rootEntries) => {
	if (!is_preloaded) {
		log.write('No preloaded listfile available, falling back to normal loading');
		return 0;
	}
	
	try {
		log.write('Applying preloaded listfile data...');
		
		let valid_entries = 0;
		if (!is_binary_mode) {
			for (const [fileDataID, fileName] of preloadedIdLookup.entries()) {
				if (rootEntries.has(fileDataID)) {
					legacy_id_lookup.set(fileDataID, fileName);
					legacy_name_lookup.set(fileName, fileDataID);
					valid_entries++;
				}
			}
		} else {
			for (const id of binary_id_to_offset.keys()) {
				if (!rootEntries.has(id)) {
					binary_id_to_offset.delete(id);
					binary_id_to_flags.delete(id);
				} else {
					valid_entries++;
				}
			}
		}
		
		if (valid_entries === 0) {
			log.write('No preloaded entries matched rootEntries');
			return 0;
		}
		
		const filterAndFormat = (fileDataIDs) => {
			const result = formatEntries(fileDataIDs.filter(id => rootEntries.has(id)));
			fileDataIDs.length = 0;
			return result;
		};
		
		core.view.listfileTextures = filterAndFormat(preload_textures);
		core.view.listfileSounds = filterAndFormat(preload_sounds);
		core.view.listfileVideos = filterAndFormat(preload_videos);
		core.view.listfileText = filterAndFormat(preload_text);
		core.view.listfileModels = filterAndFormat(preload_models);
		
		loaded = true;
		log.write('Applied %d preloaded listfile entries', valid_entries);
	} catch (e) {
		log.write('Error applying preloaded listfile: %s', e.message);
	}
};

const loadUnknownTextures = async () => {
	await DBTextureFileData.ensureInitialized();
	const unkBlp = await loadIDTable(DBTextureFileData.getFileDataIDs(), '.blp');
	log.write('Added %d unknown BLP textures from TextureFileData to listfile', unkBlp);
	return unkBlp;
};

const loadUnknownModels = async () => {
	const unkM2 = await loadIDTable(DBModelFileData.getFileDataIDs(), '.m2');
	log.write('Added %d unknown M2 models from ModelFileData to listfile', unkM2);
	return unkM2;
};

const loadUnknowns = async () => {
	await loadUnknownModels();
};

const loadIDTable = async (ids, ext) => {
	let loadCount = 0;
	
	if (is_binary_mode) {
		for (const fileDataID of ids) {
			if (!binary_id_to_offset.has(fileDataID)) {
				const fileName = 'unknown/' + fileDataID + ext;
				// todo: add to binary structures properly
				log.write('Cannot add unknown files to binary listfile yet: %s', fileName);
			}
		}
	} else {
		for (const fileDataID of ids) {
			if (!legacy_id_lookup.has(fileDataID)) {
				const fileName = 'unknown/' + fileDataID + ext;
				legacy_id_lookup.set(fileDataID, fileName);
				legacy_name_lookup.set(fileName, fileDataID);
				loadCount++;
			}
		}
	}
	
	return loadCount;
};

const getFilenamesByExtension = (exts) => {
	if (!Array.isArray(exts))
		exts = [exts];
	
	let entries = [];
	
	if (is_binary_mode) {
		// binary mode: read strings from mmap and check extensions
		for (const [fileDataID, offset] of binary_id_to_offset.entries()) {
			const filename = binary_read_string_at_offset(offset);
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
		}
	} else {
		// legacy mode
		for (const [fileDataID, filename] of legacy_id_lookup.entries()) {
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
		}
	}
	
	return formatEntries(entries);
};

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
	if (is_binary_mode) {
		// todo: add to binary structures properly
		log.write('Cannot ingest identified files to binary listfile yet');
		return;
	}
	
	for (const [fileDataID, ext] of entries) {
		const fileName = 'unknown/' + fileDataID + ext;
		legacy_id_lookup.set(fileDataID, fileName);
		legacy_name_lookup.set(fileName, fileDataID);
	}
	
	core.events.emit('listfile-needs-updating');
};

/**
* Returns a full listfile, sorted and formatted.
* @returns {Array}
*/
const getFullListfile = () => {
	if (is_binary_mode)
		return formatEntries([...binary_id_to_offset.keys()]);
	
	return formatEntries([...legacy_id_lookup.keys()]);
};

/**
* Read string at offset from memory-mapped binary strings file
* @param {number} offset
* @returns {string}
*/
const binary_read_string_at_offset = (offset) => {
	const data = binary_strings_mmap.data;
	let end = offset;
	while (end < data.length && data[end] !== 0)
		end++;
	
	return Buffer.from(data.subarray(offset, end)).toString('utf8');
};

/**
* Get a filename from a given file data ID.
* @param {number} id
* @returns {string|undefined}
*/
const getByID = (id) => {
	if (is_binary_mode) {
		const offset = binary_id_to_offset.get(id);
		if (offset === undefined)
			return undefined;
		
		return binary_read_string_at_offset(offset);
	}
	
	return legacy_id_lookup.get(id);
};

/**
* Get a filename from a given file data ID or format it as an unknown file.
* @param {number} id
* @param {string} [ext]
* @returns {string}
*/
const getByIDOrUnknown = (id, ext = '') => {
	const result = getByID(id);
	return result ?? formatUnknownFile(id, ext);
};

/**
* Get a file data ID by a given file name.
* @param {string} filename
* @returns {number|undefined}
*/
const getByFilename = (filename) => {
	filename = filename.toLowerCase().replace(/\\/g, '/');
	
	if (is_binary_mode) {
		const components = filename.split('/');
		let node_ofs = 0;
		
		for (let i = 0; i < components.length - 1; i++) {
			const component = components[i];
			node_ofs = listfile_binary_find_component_child(node_ofs, component);
			if (node_ofs === -1)
				return undefined;
		}
		
		const target_filename = components[components.length - 1];
		return listfile_binary_find_file(node_ofs, target_filename);
	}
	
	let lookup = legacy_name_lookup.get(filename);
	
	// In the rare occasion we have a reference to an MDL/MDX file and it fails
	// to resolve (as expected), attempt to resolve the M2 of the same name.
	if (!lookup && (filename.endsWith('.mdl') || filename.endsWith('mdx')))
		lookup = legacy_name_lookup.get(ExportHelper.replaceExtension(filename, '.m2'));
	
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
	
	if (is_binary_mode) {
		for (const [fileDataID, offset] of binary_id_to_offset.entries()) {
			const fileName = binary_read_string_at_offset(offset);
			if (isRegExp ? fileName.match(search) : fileName.includes(search))
				results.push({ fileDataID, fileName });
		}
	} else {
		for (const [fileDataID, fileName] of legacy_id_lookup.entries()) {
			if (isRegExp ? fileName.match(search) : fileName.includes(search))
				results.push({ fileDataID, fileName });
		}
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
	if (is_binary_mode) {
		// todo: add to binary structures properly
		log.write('Cannot add entry to binary listfile yet: %s -> %s', fileDataID, fileName);
		return;
	}
	
	legacy_id_lookup.set(fileDataID, fileName);
	legacy_name_lookup.set(fileName, fileDataID);
};
// endregion

module.exports = {
	loadUnknowns,
	loadUnknownTextures,
	loadUnknownModels,
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