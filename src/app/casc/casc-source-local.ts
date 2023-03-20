/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';

import { state } from '../core';
import Log from '../log';
import Constants from '../constants';
import BufferWrapper from '../buffer';
import Listfile from './listfile';
import Events from '../events';
import { readFile } from '../generics';

import * as VersionConfig from './version-config';
import * as ConfigReader from './config-reader';
import BuildCache from './build-cache';
import BLTEReader from './blte-reader';

import CASC from './casc-source';
import CASCRemote from './casc-source-remote';

type IndexEntry = { index: number, offset: number, size: number };

export default class CASCLocal extends CASC {
	dir: string;
	dataDir: string;
	storageDir: string;
	localIndexes: Map<string, IndexEntry> = new Map();
	remote: CASCRemote;

	/**
	 * Create a new CASC source using a local installation.
	 * @param dir - Installation path.
	 */
	constructor(dir: string) {
		super(false);

		this.dir = dir;
		this.dataDir = path.join(dir, Constants.BUILD.DATA_DIR);
		this.storageDir = path.join(this.dataDir, 'data');

		this.localIndexes = new Map();
	}

	/**
	 * Initialize local CASC source.
	 */
	async init(): Promise<void> {
		Log.write('Initializing local CASC installation: %s', this.dir);

		const buildInfo = path.join(this.dir, Constants.BUILD.MANIFEST);
		const config = VersionConfig.parse(await fs.readFile(buildInfo, 'utf8'));

		// Filter known products.
		this.builds = config.filter((entry: VersionConfig.BuildInfo) => Constants.PRODUCTS.some(e => e.product === entry.Product));

		Log.write('%o', this.builds);
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param fileDataID
	 * @param partialDecryption
	 * @param suppressLog
	 * @param supportFallback
	 * @param forceFallback
	 * @param contentKey
	 */
	async getFile(fileDataID: number, partialDecryption = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null): Promise<BLTEReader> {
		if (!suppressLog)
			Log.write('Loading local CASC file %d (%s)', fileDataID, Listfile.getByID(fileDataID) as string);

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getEncodingKey(fileDataID);
		const data = supportFallback ? await this.getDataFileWithRemoteFallback(encodingKey, forceFallback) : await this.getDataFile(encodingKey);
		return new BLTEReader(data, encodingKey, partialDecryption);
	}

	/**
	 * Returns a list of available products in the installation.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList(): Array<string> {
		const products: Array<string> = [];
		for (const entry of this.builds) {
			const product = Constants.PRODUCTS.find(e => e.product === entry.Product);
			products.push(util.format('%s (%s) %s', product?.title ?? 'Unknown', entry.Branch.toUpperCase(), entry.Version));
		}

		return products;
	}

	/**
	 * Load the CASC interface with the given build.
	 * @param buildIndex
	 */
	async load(buildIndex: number): Promise<void> {
		this.build = this.builds[buildIndex];
		Log.write('Loading local CASC build: %o', this.build);

		this.cache = new BuildCache(this.build.BuildKey);
		await this.cache.init();

		this.progress = state.createProgress(13);
		await this.loadConfigs();
		await this.loadIndexes();
		await this.loadEncoding();
		await this.loadRoot();

		state.casc = this;

		await this.loadListfile(this.build.BuildKey);
		await this.loadTables();
		await this.filterListfile();
		await this.initializeComponents();

		Events.emit('casc:loaded');
	}

	/**
	 * Load the BuildConfig from the installation directory.
	 */
	async loadConfigs(): Promise<void> {
		// Load and parse BuildConfig from disk.
		await this.progress.step('Fetching build configurations');
		this.buildConfig = ConfigReader.parse(await fs.readFile(this.formatConfigPath(this.build.BuildKey), 'utf8'));
		this.cdnConfig = ConfigReader.parse(await fs.readFile(this.formatConfigPath(this.build.CDNKey), 'utf8'));

		Log.write('BuildConfig: %o', this.buildConfig);
		Log.write('CDNConfig: %o', this.cdnConfig);
	}

	/**
	 * Load and parse storage indexes from the local installation.
	 */
	async loadIndexes(): Promise<void> {
		Log.timeLog();
		await this.progress.step('Loading indexes');

		let indexCount = 0;

		const entries = await fs.readdir(this.storageDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.idx')) {
				await this.parseIndex(path.join(this.storageDir, entry.name));
				indexCount++;
			}
		}

		Log.timeEnd('Loaded %d entries from %d journal indexes', this.localIndexes.size, indexCount);
	}

	/**
	 * Parse a local installation journal index for entries.
	 * @param {string} file Path to the index.
	 */
	async parseIndex(file): Promise<void> {
		const entries = this.localIndexes;
		const index = new BufferWrapper(await fs.readFile(file));

		const headerHashSize = index.readInt32();
		index.move(4); // headerHash uint32
		index.move(headerHashSize as number); // headerHash byte[headerHashSize]

		index.seek((8 + (headerHashSize as number) + 0x0F) & 0xFFFFFFF0); // Next 0x10 boundary.

		const dataLength = index.readInt32();
		index.move(4);

		const nBlocks = dataLength as number / 18;
		for (let i = 0; i < nBlocks; i++) {
			const key = index.readString(9, 'hex');
			if (entries.has(key)) {
				index.move(1 + 4 + 4); // idxHigh + idxLow + size
				continue;
			}

			const idxHigh = index.readUInt8();
			const idxLow = index.readInt32BE();

			entries.set(key, {
				index: (idxHigh as number << 2 | ((idxLow as number & 0xC0000000) >>> 30)),
				offset: (idxLow as number) & 0x3FFFFFFF,
				size: index.readInt32() as number
			});
		}
	}

	/**
	 * Load and parse encoding from the local installation.
	 */
	async loadEncoding(): Promise<void> {
		// Parse encoding file.
		Log.timeLog();
		const encKeys = this.buildConfig.encoding.split(' ');

		await this.progress.step('Loading encoding table');
		const encRaw = await this.getDataFileWithRemoteFallback(encKeys[1]);
		await this.parseEncodingFile(encRaw, encKeys[1]);
		Log.timeEnd('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	/**
	 * Load and parse root table from local installation.
	 */
	async loadRoot(): Promise<void> {
		// Get root key from encoding table.
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		// Parse root file.
		Log.timeLog();
		await this.progress.step('Loading root file');
		const root = await this.getDataFileWithRemoteFallback(rootKey);
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		Log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	/**
	 * Initialize a remote CASC instance to download missing
	 * files needed during local initialization.
	 */
	async initializeRemoteCASC(): Promise<void> {
		const remote = new CASCRemote(state.selectedCDNRegion.tag);
		await remote.init();

		const buildIndex = remote.builds.findIndex(build => build.Product === this.build.Product);
		await remote.preload(buildIndex, this.cache);

		this.remote = remote;
	}

	/**
	 * Obtain a data file from the local archives.
	 * If not stored locally, file will be downloaded from a CDN.
	 * @param key
	 * @param forceFallback Whether or not to force fallback to CDN, defaults to false
	 */
	async getDataFileWithRemoteFallback(key: string, forceFallback = false): Promise<BufferWrapper> {
		try {
			// If forceFallback is true, we have corrupt local data.
			if (forceFallback)
				throw new Error('Local data is corrupted, forceFallback set.');

			// Attempt 1: Extract from local archives.
			const local = await this.getDataFile(key);

			if (!BLTEReader.check(local))
				throw new Error('Local data file is not a valid BLTE');

			return local;
		} catch (e) {
			// Attempt 2: Load from cache from previous fallback.
			Log.write('Local file %s does not exist, falling back to cache...', key);
			const cached = await this.cache.getFile(key, Constants.CACHE.DIR_DATA);
			if (cached !== null)
				return cached;

			// Attempt 3: Download from CDN.
			Log.write('Local file %s not cached, falling back to CDN...', key);
			if (!this.remote)
				await this.initializeRemoteCASC();

			const archive = this.remote.archives.get(key);
			let data;
			if (archive !== undefined) {
				// Archive exists for key, attempt partial remote download.
				Log.write('Local file %s has archive, attempt partial download...', key);
				data = await this.remote.getDataFilePartial(this.remote.formatCDNKey(archive.key), archive.offset, archive.size);
			} else {
				// No archive for this file, attempt direct download.
				Log.write('Local file %s has no archive, attempting direct download...', key);
				data = await this.remote.getDataFile(this.remote.formatCDNKey(key));
			}

			this.cache.storeFile(key, data, Constants.CACHE.DIR_DATA);
			return data;
		}
	}

	/**
	 * Obtain a data file from the local archives.
	 * @param key
	 */
	async getDataFile(key: string): Promise<BufferWrapper> {
		const entry = this.localIndexes.get(key.substring(0, 18));
		if (!entry)
			throw new Error('Requested file does not exist in local data: ' + key);

		const data = await readFile(this.formatDataPath(entry.index), entry.offset + 0x1E, entry.size - 0x1E);

		let isZeroed = true;
		for (let i = 0, n = data.remainingBytes; i < n; i++) {
			if (data.readUInt8() !== 0x0) {
				isZeroed = false;
				break;
			}
		}

		if (isZeroed)
			throw new Error('Requested data file is empty or missing: ' + key);

		data.seek(0);
		return data;
	}

	/**
	 * Format a local path to a data archive.
	 * 67 -> <install>/Data/data/data.067
	 * @param id
	 */
	formatDataPath(id: number): string {
		return path.join(this.dataDir, 'data', 'data.' + id.toString().padStart(3, '0'));
	}

	/**
	 * Format a local path to an archive index from the key.
	 * 0b45bd2721fd6c86dac2176cbdb7fc5b -> <install>/Data/indices/0b45bd2721fd6c86dac2176cbdb7fc5b.index
	 * @param key
	 */
	formatIndexPath(key: string): string {
		return path.join(this.dataDir, 'indices', key + '.index');
	}

	/**
	 * Format a local path to a config file from the key.
	 * 0af716e8eca5aeff0a3965d37e934ffa -> <install>/Data/config/0a/f7/0af716e8eca5aeff0a3965d37e934ffa
	 * @param key
	 */
	formatConfigPath(key: string): string {
		return path.join(this.dataDir, 'config', this.formatCDNKey(key));
	}

	/**
	 * Format a CDN key for use in local file reading.
	 * Path separators used by this method are platform specific.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49\29\49299eae4e3a195953764bb4adb3c91f
	 * @param key
	 */
	formatCDNKey(key: string): string {
		return path.join(key.substring(0, 2), key.substring(2, 4), key);
	}

	/**
	* Get the current build ID.
	* @returns
	*/
	getBuildName(): string {
		return this.build.Version;
	}

	/**
	 * Returns the build configuration key.
	 * @returns
	 */
	getBuildKey(): string {
		return this.build.BuildKey;
	}
}