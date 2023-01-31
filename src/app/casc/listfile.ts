/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import util from 'node:util';
import fs from 'node:fs';
import Log from '../log';
import State from '../state';
import Events from '../events';
import Constants from '../constants';
import BufferWrapper from '../buffer';
import WDCReader from '../db/WDCReader';
import BuildCache from './build-cache';
import ExportHelper from './export-helper';
import { downloadFile } from '../generics';

import * as DBTextureFileData from '../db/caches/DBTextureFileData';
import * as DBModelFileData from '../db/caches/DBModelFileData';

const nameLookup = new Map<string, number>();
const idLookup = new Map<number, string>();

let loaded: boolean = false;

type ListfileEntry = {
	fileDataID: number;
	fileName: string;
};

/**
 * Load listfile for the given build configuration key.
 * @param buildConfig
 * @param cache
 * @param rootEntries
 * @returns The amount of files loaded.
 */
export async function loadListfile(buildConfig: string, cache: BuildCache, rootEntries: Map<number, Map<number, string>>): Promise<number> {
	Log.write('Loading listfile for build %s', buildConfig);

	let url = String(State.config.listfileURL);
	if (typeof url !== 'string')
		throw new Error('Missing/malformed listfileURL in configuration!');

	// Replace optional buildID wildcard.
	if (url.includes('%s'))
		url = util.format(url, buildConfig);

	idLookup.clear();
	nameLookup.clear();

	let data: BufferWrapper;
	if (url.startsWith('http')) {
		// Listfile URL is http, check for cache/updates.
		let requireDownload = false;
		const cached = await cache.getFile(Constants.CACHE.BUILD_LISTFILE, null);

		if (cache.meta.lastListfileUpdate) {
			let ttl = Number(State.config.listfileCacheRefresh) || 0;
			ttl *= 24 * 60 * 60 * 1000; // Reduce from days to milliseconds.

			if (ttl === 0 || (Date.now() - cache.meta.lastListfileUpdate) > ttl) {
				// Local cache file needs updating (or has invalid manifest entry).
				Log.write('Cached listfile for %s is out-of-date (> %d).', buildConfig, ttl);
				requireDownload = true;
			} else {
				// Ensure that the local cache file *actually* exists before relying on it.
				if (cached === null) {
					Log.write('Listfile for %s is missing despite meta entry. User tamper?', buildConfig);
					requireDownload = true;
				} else {
					Log.write('Listfile for %s is cached locally.', buildConfig);
				}
			}
		} else {
			// This listfile has never been updated.
			requireDownload = true;
			Log.write('Listfile for %s is not cached, downloading fresh.', buildConfig);
		}

		if (requireDownload) {
			try {
				data = await downloadFile(url);
				cache.storeFile(Constants.CACHE.BUILD_LISTFILE, data);

				cache.meta.lastListfileUpdate = Date.now();
				cache.saveManifest();
			} catch {
				if (cached === null)
					throw new Error('Failed to download listfile, no cached version for fallback');

				Log.write('Failed to download listfile, using cached as redundancy.');
				data = cached;
			}
		} else {
			data = cached;
		}
	} else {
		// User has configured a local listfile location.
		Log.write('Loading user-defined local listfile: %s', url);
		data = new BufferWrapper(await fs.promises.readFile(url));
	}

	// Parse all lines in the listfile.
	// Example: 53187;sound/music/citymusic/darnassus/druid grove.mp3
	const lines = data.readString().split(/\r?\n/);
	for (const line of lines) {
		const tokens = line.split(';');

		if (tokens.length !== 2) {
			Log.write('Invalid listfile line (token count): %s', line);
			return;
		}

		const fileDataID = Number(tokens[0]);
		if (isNaN(fileDataID)) {
			Log.write('Invalid listfile line (non-numerical ID): %s', line);
			return;
		}

		if (rootEntries.has(fileDataID)) {
			const fileName = tokens[1].toLowerCase();
			idLookup.set(fileDataID, fileName);
			nameLookup.set(fileName, fileDataID);
		}
	}

	loaded = true;
	Log.write('%d listfile entries loaded', idLookup.size);
	return idLookup.size;
}

/**
 * Load unknown files from TextureFileData/ModelFileData.
 * Must be called after DBTextureFileData/DBModelFileData have loaded.
 */
export async function loadUnknowns() {
	const unkBlp = loadIDTable(DBTextureFileData.getFileDataIDs(), '.blp');
	const unkM2 = loadIDTable(DBModelFileData.getFileDataIDs(), '.m2');

	Log.write('Added %d unknown BLP textures from TextureFileData to listfile', unkBlp);
	Log.write('Added %d unknown M2 models from ModelFileData to listfile', unkM2);

	// Load unknown sounds from SoundKitEntry table.
	const soundKitEntries = new WDCReader('DBFilesClient/SoundKitEntry.db2');
	await soundKitEntries.parse();

	let unknownCount = 0;
	for (const entry of soundKitEntries.getAllRows().values()) {
		if (!idLookup.has(entry.FileDataID as number)) {
			// List unknown sound files using the .unk_sound extension. Files will be
			// dynamically checked upon export and given the correct extension.
			const fileName = 'unknown/' + entry.FileDataID + '.unk_sound';
			idLookup.set(entry.FileDataID as number, fileName);
			nameLookup.set(fileName, entry.FileDataID as number);
			unknownCount++;
		}
	}

	Log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknownCount);
}

/**
 * Load file IDs from a data table.
 * @param ids - Set of file IDs to load
 * @param ext - File extension to use for unknown files.
 * @returns Number of files loaded.
 */
export function loadIDTable(ids: Set<number>, ext: string): number {
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
}

/**
 * Return an array of filenames ending with the given extension(s).
 * @param exts - Extension (or array of extensions) of files to return
 * @returns Array of filenames
 */
export function getFilenamesByExtension(exts: string | Array<string>): Array<string> {
	// Box into an array for reduced code.
	if (!Array.isArray(exts))
		exts = [exts];

	const entries = Array<number>();

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
}

/**
 * Sort and format listfile entries for file list display.
 * @param entries - Unsorted entries
 * @returns Sorted entries
 */
export function formatEntries(entries: Array<number>): Array<string> {
	// If sorting by ID, perform the sort while the array is only IDs.
	if (State.config.listfileSortByID)
		entries.sort((a, b) => a - b);

	let namedEntries: Array<string>;
	if (State.config.listfileShowFileDataIDs)
		namedEntries = entries.map(e => getByIDOrUnknown(e) + ' [' + e + ']');
	else
		namedEntries = entries.map(e => getByIDOrUnknown(e));

	// If sorting by name, sort now that the filenames have been added.
	if (!State.config.listfileSortByID)
		namedEntries.sort();

	return namedEntries;
}

export function ingestIdentifiedFiles(entries: Map<number, string>) {
	for (const [fileDataID, ext] of entries) {
		const fileName = 'unknown/' + fileDataID + ext;
		idLookup.set(fileDataID, fileName);
		nameLookup.set(fileName, fileDataID);
	}

	Events.emit('listfile-needs-updating');
}

/**
 * Returns a full listfile, sorted and formatted.
 * @returns Full listfile
 */
export function getFullListfile() {
	return formatEntries([...idLookup.keys()]);
}

/**
 * Get a filename from a given file data ID.
 * @param id - FileDataID
 * @returns Filename if found, otherwise undefined
 */
export function getByID(id: number): string | undefined {
	return idLookup.get(id);
}

/**
 * Get a filename from a given file data ID or format it as an unknown file.
 * @param id - FileDataID
 * @param ext - Optional extension to use for unknown files
 * @returns Known filename or formatted unknown name
 */
export function getByIDOrUnknown(id: number, ext = ''): string {
	return idLookup.get(id) ?? formatUnknownFile(id, ext);
}

/**
 * Get a file data ID by a given file name.
 * @param filename
 * @returns FileDataID if found, undefined otherwise
 */
export function getByFilename(filename: string): number | undefined {
	let lookup = nameLookup.get(filename.toLowerCase().replace(/\\/g, '/'));

	// In the rare occasion we have a reference to an MDL/MDX file and it fails
	// to resolve (as expected), attempt to resolve the M2 of the same name.
	if (!lookup && (filename.endsWith('.mdl') || filename.endsWith('mdx')))
		lookup = nameLookup.get(ExportHelper.replaceExtension(filename, '.m2').replace(/\\/g, '/'));

	return lookup;
}

/**
 * Returns an array of listfile entries filtered by the given search term.
 * @param search Search string (can be a regular expression)
 * @returns Filtered listfile entries
 */
export function getFilteredEntries(search: string | RegExp): Array<ListfileEntry> {
	const results = Array<ListfileEntry>();
	const isRegExp = search instanceof RegExp;

	for (const [fileDataID, fileName] of idLookup.entries()) {
		if (isRegExp ? fileName.match(search) : fileName.includes(search))
			results.push({ fileDataID, fileName });
	}

	return results;
}

/**
 * Strips a prefixed file ID from a listfile entry.
 * @param entry - Listfile entry
 * @returns Listfile entry without prefixed file ID
 */
export function stripFileEntry(entry: string): string {
	if (typeof entry === 'string' && entry.includes(' ['))
		return entry.substring(0, entry.lastIndexOf(' ['));

	return entry;
}

/**
 * @param fileDataID - ID of the file.
 * @param ext - Optional file extension.
 * @returns Formatted unknown file path
 */
export function formatUnknownFile(fileDataID: number, ext = ''): string {
	return 'unknown/' + fileDataID + ext;
}

/**
 * Returns true if a listfile has been loaded.
 * @returns If listfile is loaded
 */
export function isLoaded(): boolean {
	return loaded;
}

export default {
	getFilenamesByExtension,
	getFullListfile,
	getByID,
	getByIDOrUnknown,
	getByFilename,
	getFilteredEntries,
	stripFileEntry,
	formatUnknownFile,
	isLoaded,
	ingestIdentifiedFiles
};