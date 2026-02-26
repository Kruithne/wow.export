import path from 'node:path';
import util from 'node:util';
import fsp from 'node:fs/promises';
import * as generics from '../lib/generics.js';
import * as constants from '../lib/constants.js';
import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import BufferWrapper from '../lib/buffer.js';
import ExportHelper from './export-helper.js';
import * as mmap from '../lib/mmap.js';
import XXH64 from '../hashing/xxhash64.js';
import * as DBTextureFileData from '../db/caches/DBTextureFileData.js';
import * as DBModelFileData from '../db/caches/DBModelFileData.js';

const BIN_LF_COMPONENTS = {
	ID_INDEX: 'listfile-id-index.dat',
	STRINGS: 'listfile-strings.dat',
	TREE_NODES: 'listfile-tree-nodes.dat',
	PF_MODELS: 'listfile-pf-models.dat',
	PF_TEXTURES: 'listfile-pf-textures.dat',
	PF_SOUNDS: 'listfile-pf-sounds.dat',
	PF_VIDEOS: 'listfile-pf-videos.dat',
	PF_TEXT: 'listfile-pf-text.dat',
	PF_FONTS: 'listfile-pf-fonts.dat'
};

const legacy_name_lookup = new Map();
const legacy_id_lookup = new Map();

let loaded = false;

let preloadedIdLookup = new Map();
let preloadedNameLookup = new Map();

let binary_id_to_offset = new Map();
let binary_id_to_pf_index = new Map();

let binary_strings_mmap = [];
let binary_tree_nodes_mmap = null;

let is_binary_mode = false;

let preload_textures = null;
let preload_sounds = null;
let preload_text = null;
let preload_fonts = null;
let preload_models = null;

let is_preloaded = false;
let preload_promise = null;

let view_listfile_textures = null;
let view_listfile_sounds = null;
let view_listfile_text = null;
let view_listfile_fonts = null;
let view_listfile_models = null;

const listfile_check_cache_expiry = (last_modified) => {
	if (last_modified > 0) {
		let ttl = Number(core.get_config('listfileCacheRefresh')) || 0;
		ttl *= 24 * 60 * 60 * 1000;

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

		const bin_url = String(core.get_config('listfileBinarySource'));
		if (typeof bin_url !== 'string')
			throw new Error('Missing/malformed listfileBinarySource in configuration!');

		await fsp.mkdir(constants.CACHE.DIR_LISTFILE, { recursive: true });
		let last_modified = 0;

		try {
			const idx_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.ID_INDEX);
			last_modified = (await fsp.stat(idx_file)).mtime.getTime();
		} catch (e) {
			// no cached files
		}

		if (listfile_check_cache_expiry(last_modified)) {
			let download_failed = false;

			for (const file of Object.values(BIN_LF_COMPONENTS)) {
				const file_url = util.format(bin_url, file);
				const cache_file = path.join(constants.CACHE.DIR_LISTFILE, file);

				try {
					log.write('Downloading binary listfile component: %s', file);
					const data = await generics.downloadFile([file_url]);
					await fsp.writeFile(cache_file, data.raw);
				} catch (e) {
					log.write('Failed to download binary listfile component (%s): %s)', file, e.message);
					download_failed = true;
					break;
				}
			}

			if (download_failed) {
				log.write('Partial binary listfile download detected, cleaning up...');
				for (const file of Object.values(BIN_LF_COMPONENTS))
					await fsp.unlink(path.join(constants.CACHE.DIR_LISTFILE, file)).catch(() => {});

				throw new Error('Partial binary listfile download, falling back to legacy');
			}
		}

		log.write('Loading binary listfile ID index into memory...');
		const idx_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.ID_INDEX);
		const idx_buffer = await BufferWrapper.readFile(idx_file);

		binary_id_to_offset.clear();
		binary_id_to_pf_index.clear();

		const entry_count = idx_buffer.byteLength / 9;
		for (let i = 0; i < entry_count; i++) {
			const id = idx_buffer.readUInt32BE();
			const string_offset = idx_buffer.readUInt32BE();
			const pf_index = idx_buffer.readUInt8();

			binary_id_to_offset.set(id, string_offset);
			binary_id_to_pf_index.set(id, pf_index);
		}

		log.write('Loaded %d binary listfile entries', binary_id_to_offset.size);

		preload_models = new Map();
		preload_textures = new Map();
		preload_sounds = new Map();
		preload_text = new Map();
		preload_fonts = new Map();

		// pf_preload_map indices must match pf_files indices
		// null = skip preloading (videos loaded dynamically from MovieVariation)
		const pf_preload_map = [
			null,
			preload_models,
			preload_textures,
			preload_sounds,
			null,
			preload_text,
			preload_fonts
		];

		const pf_files = [
			BIN_LF_COMPONENTS.STRINGS,
			BIN_LF_COMPONENTS.PF_MODELS,
			BIN_LF_COMPONENTS.PF_TEXTURES,
			BIN_LF_COMPONENTS.PF_SOUNDS,
			BIN_LF_COMPONENTS.PF_VIDEOS,
			BIN_LF_COMPONENTS.PF_TEXT,
			BIN_LF_COMPONENTS.PF_FONTS
		];

		binary_strings_mmap = new Array(7);

		for (let i = 0; i < pf_files.length; i++) {
			try {
				const mmap_obj = mmap.create_virtual_file();
				const file_path = path.join(constants.CACHE.DIR_LISTFILE, pf_files[i]);
				log.write('Mapping pf file %d: %s', i, file_path);
				if (!mmap_obj.mapFile(file_path, { protection: 'readonly' }))
					throw new Error('Failed to map pf file: ' + mmap_obj.lastError);

				binary_strings_mmap[i] = mmap_obj;
			} catch (e) {
				log.write('Error mapping pf file %d: %s', i, e.message);
				throw e;
			}
		}

		for (let i = 1; i < pf_files.length; i++) {
			const preload_map = pf_preload_map[i];
			if (preload_map === null)
				continue;

			const file_path = path.join(constants.CACHE.DIR_LISTFILE, pf_files[i]);
			log.write('Preloading pf file %d: %s', i, file_path);

			const file_buffer = await BufferWrapper.readFile(file_path);
			const entry_count = file_buffer.readUInt32BE();

			for (let j = 0; j < entry_count; j++) {
				const file_data_id = file_buffer.readUInt32BE();
				const filename = file_buffer.readNullTerminatedString('utf8');
				preload_map.set(file_data_id, filename);
			}

			log.write('Preloaded %d entries from pf file %d', preload_map.size, i);
		}

		try {
			binary_tree_nodes_mmap = mmap.create_virtual_file();
			const tree_nodes_file = path.join(constants.CACHE.DIR_LISTFILE, BIN_LF_COMPONENTS.TREE_NODES);
			log.write('Mapping tree nodes file: %s', tree_nodes_file);
			if (!binary_tree_nodes_mmap.mapFile(tree_nodes_file, { protection: 'readonly' }))
				throw new Error('Failed to map tree nodes file: ' + binary_tree_nodes_mmap.lastError);
		} catch (e) {
			log.write('Error mapping tree nodes file: %s', e.message);
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
	const target_hash = XXH64(component_name);

	const node_data = binary_tree_nodes_mmap.data;
	const view = new DataView(node_data.buffer, node_data.byteOffset + node_ofs);

	const child_count = view.getUint32(0, false);
	const child_entries_ofs = 9;

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

	const file_entries_start = 9 + (child_count * 12);

	if (is_large_dir) {
		const target_hash = XXH64(filename);

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

const listfile_binary_lookup_filename = (filename) => {
	const direct_lookup = legacy_name_lookup.get(filename);
	if (direct_lookup !== undefined)
		return direct_lookup;

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
};

const binary_read_string_at_offset = (pf_index, offset) => {
	const data = binary_strings_mmap[pf_index].data;
	let end = offset;
	while (end < data.length && data[end] !== 0)
		end++;

	return Buffer.from(data.subarray(offset, end)).toString('utf8');
};
// endregion

// region legacy
const listfile_preload_legacy = async () => {
	try {
		let url = String(core.get_config('listfileURL'));
		if (typeof url !== 'string')
			throw new Error('Missing/malformed listfileURL in configuration!');

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
				// no cached file
			}

			if (listfile_check_cache_expiry(last_modified)) {
				try {
					let fallback_url = String(core.get_config('listfileFallbackURL'));
					fallback_url = fallback_url.replace('%s', '');

					data = await generics.downloadFile([url, fallback_url]);
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

		preload_textures = await getFileDataIDsByExtension('.blp', 'filtering textures');
		preload_sounds = await getFileDataIDsByExtension(['.ogg', '.mp3', '.unk_sound'], 'filtering sounds');
		preload_text = await getFileDataIDsByExtension(['.txt', '.lua', '.xml', '.sbt', '.wtf', '.htm', '.toc', '.xsd'], 'filtering text files');
		preload_fonts = await getFileDataIDsByExtension('.ttf', 'filtering fonts');

		const model_exts = ['.m2', '.m3'];
		model_exts.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);
		preload_models = await getFileDataIDsByExtension(model_exts, 'filtering models');

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

	if (core.get_config('enableBinaryListfile')) {
		if (await listfile_preload_binary()) {
			log.write('Binary listfile loaded successfully');
			is_preloaded = true;
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

			view_listfile_textures = formatEntries(preload_textures);
			view_listfile_sounds = formatEntries(preload_sounds);
			view_listfile_text = formatEntries(preload_text);
			view_listfile_fonts = formatEntries(preload_fonts);
			view_listfile_models = formatEntries(preload_models);
		} else {
			for (const id of binary_id_to_offset.keys()) {
				if (!rootEntries.has(id)) {
					binary_id_to_offset.delete(id);
					binary_id_to_pf_index.delete(id);
				} else {
					valid_entries++;
				}
			}

			const filterMapToIds = (preload_map) => {
				const filtered_ids = [];
				for (const fid of preload_map.keys()) {
					if (rootEntries.has(fid))
						filtered_ids.push(fid);
				}
				return filtered_ids;
			};

			const filter_and_format = (preload_map) => {
				const filtered_ids = filterMapToIds(preload_map);
				const formatted_array = new Array(filtered_ids.length);
				for (let i = 0; i < filtered_ids.length; i++) {
					const fid = filtered_ids[i];
					const filename = preload_map.get(fid);
					formatted_array[i] = `${filename} [${fid}]`;
				}
				preload_map.clear();
				return formatted_array;
			};

			view_listfile_textures = filter_and_format(preload_textures);
			view_listfile_sounds = filter_and_format(preload_sounds);
			view_listfile_text = filter_and_format(preload_text);
			view_listfile_fonts = filter_and_format(preload_fonts);
			view_listfile_models = filter_and_format(preload_models);
		}

		if (valid_entries === 0) {
			log.write('No preloaded entries matched rootEntries');
			return 0;
		}

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

	for (const fileDataID of ids) {
		if (!existsByID(fileDataID)) {
			const fileName = 'unknown/' + fileDataID + ext;
			legacy_id_lookup.set(fileDataID, fileName);
			legacy_name_lookup.set(fileName, fileDataID);
			loadCount++;
		}
	}

	return loadCount;
};

const getFilenamesByExtension = (exts) => {
	if (!Array.isArray(exts))
		exts = [exts];

	let entries = [];

	if (is_binary_mode) {
		for (const [fileDataID, offset] of binary_id_to_offset.entries()) {
			const pf_index = binary_id_to_pf_index.get(fileDataID);
			const filename = binary_read_string_at_offset(pf_index, offset);
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

const formatEntries = (file_data_ids) => {
	if (core.get_config('listfileSortByID'))
		file_data_ids.sort((a, b) => a - b);

	const n_entries = file_data_ids.length;
	const entries = new Array(n_entries);

	for (let i = 0; i < n_entries; i++) {
		const fid = file_data_ids[i];
		entries[i] = `${getByIDOrUnknown(fid)} [${fid}]`;
	}

	if (!core.get_config('listfileSortByID'))
		entries.sort();

	return entries;
};

const ingestIdentifiedFiles = (entries) => {
	for (const [fileDataID, ext] of entries) {
		const fileName = 'unknown/' + fileDataID + ext;
		legacy_id_lookup.set(fileDataID, fileName);
		legacy_name_lookup.set(fileName, fileDataID);
	}
};

const renderListfile = async (file_data_ids, include_main_index = false) => {
	const result = [];

	if (is_binary_mode) {
		const pf_files = [
			BIN_LF_COMPONENTS.STRINGS,
			BIN_LF_COMPONENTS.PF_MODELS,
			BIN_LF_COMPONENTS.PF_TEXTURES,
			BIN_LF_COMPONENTS.PF_SOUNDS,
			BIN_LF_COMPONENTS.PF_VIDEOS,
			BIN_LF_COMPONENTS.PF_TEXT,
			BIN_LF_COMPONENTS.PF_FONTS
		];

		const start_index = include_main_index ? 0 : 1;
		const id_set = file_data_ids ? new Set(file_data_ids) : null;

		for (let i = start_index; i < pf_files.length; i++) {
			const file_path = path.join(constants.CACHE.DIR_LISTFILE, pf_files[i]);
			const file_buffer = await BufferWrapper.readFile(file_path);
			const entry_count = file_buffer.readUInt32BE();

			for (let j = 0; j < entry_count; j++) {
				const file_data_id = file_buffer.readUInt32BE();
				const filename = file_buffer.readNullTerminatedString('utf8');

				if (id_set === null || id_set.has(file_data_id))
					result.push(`${filename} [${file_data_id}]`);
			}
		}
	}

	if (file_data_ids === undefined) {
		for (const [file_data_id, filename] of legacy_id_lookup)
			result.push(`${filename} [${file_data_id}]`);
	} else {
		const id_set = new Set(file_data_ids);
		for (const [file_data_id, filename] of legacy_id_lookup) {
			if (id_set.has(file_data_id))
				result.push(`${filename} [${file_data_id}]`);
		}
	}

	return result;
};

const existsByID = (id) => {
	if (legacy_id_lookup.has(id))
		return true;

	if (is_binary_mode && binary_id_to_offset.has(id))
		return true;

	return false;
};

const getByID = (id) => {
	if (is_binary_mode) {
		const direct_lookup = legacy_id_lookup.get(id);
		if (direct_lookup !== undefined)
			return direct_lookup;

		const offset = binary_id_to_offset.get(id);
		if (offset === undefined)
			return undefined;

		const pf_index = binary_id_to_pf_index.get(id);
		return binary_read_string_at_offset(pf_index, offset);
	}

	return legacy_id_lookup.get(id);
};

const getByIDOrUnknown = (id, ext = '') => {
	const result = getByID(id);
	return result ?? formatUnknownFile(id, ext);
};

const getByFilename = (filename) => {
	filename = filename.toLowerCase().replace(/\\/g, '/');

	let lookup = is_binary_mode
		? listfile_binary_lookup_filename(filename)
		: legacy_name_lookup.get(filename);

	if (!lookup && (filename.endsWith('.mdl') || filename.endsWith('mdx')))
		return getByFilename(ExportHelper.replaceExtension(filename, '.m2'));

	return lookup;
};

const getFilteredEntries = (search) => {
	const results = [];
	const isRegExp = search instanceof RegExp;

	if (is_binary_mode) {
		for (const [fileDataID, offset] of binary_id_to_offset.entries()) {
			const pf_index = binary_id_to_pf_index.get(fileDataID);
			const fileName = binary_read_string_at_offset(pf_index, offset);
			if (isRegExp ? fileName.match(search) : fileName.includes(search))
				results.push({ fileDataID, fileName });
		}

		for (const [fileDataID, fileName] of legacy_id_lookup.entries()) {
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

const stripFileEntry = (entry) => {
	if (typeof entry === 'string' && entry.includes(' ['))
		return entry.substring(0, entry.lastIndexOf(' ['));

	return entry;
};

const parseFileEntry = (entry) => {
	const file_path = stripFileEntry(entry);
	const fid_match = typeof entry === 'string' ? entry.match(/\[(\d+)\]$/) : null;
	const file_data_id = fid_match ? parseInt(fid_match[1], 10) : undefined;
	return { file_path, file_data_id };
};

const formatUnknownFile = (fileDataID, ext = '') => {
	return 'unknown/' + fileDataID + ext;
};

const isLoaded = () => {
	return loaded;
};

const addEntry = (fileDataID, fileName, listfile) => {
	fileName = fileName.toLowerCase();

	legacy_id_lookup.set(fileDataID, fileName);
	legacy_name_lookup.set(fileName, fileDataID);

	listfile?.push(`${fileName} [${fileDataID}]`);
};

const get_textures = () => view_listfile_textures;
const get_sounds = () => view_listfile_sounds;
const get_text = () => view_listfile_text;
const get_fonts = () => view_listfile_fonts;
const get_models = () => view_listfile_models;
// endregion

export {
	loadUnknowns,
	loadUnknownTextures,
	loadUnknownModels,
	preload,
	prepareListfile,
	applyPreload,
	existsByID,
	getByID,
	getByFilename,
	getFilenamesByExtension,
	getFilteredEntries,
	getByIDOrUnknown,
	stripFileEntry,
	parseFileEntry,
	formatEntries,
	formatUnknownFile,
	ingestIdentifiedFiles,
	isLoaded,
	addEntry,
	renderListfile,
	get_textures,
	get_sounds,
	get_text,
	get_fonts,
	get_models
};
