/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import { state, createProgress } from '../core';
import { get, filesize, downloadFile, queue, ping } from '../generics';
import Log from '../log';
import Constants from '../constants';
import Listfile from './listfile';
import Events from '../events';

import * as ConfigReader from './config-reader';
import * as VersionConfig from './version-config';

import BufferWrapper from '../buffer';
import BuildCache from './build-cache';
import BLTEReader from './blte-reader';

import CASC from './casc-source';

type ArchiveEntry = {
	key: string,
	size: number,
	offset: number
}

type Host = {
	host: string,
	ping: number
}

const EMPTY_HASH = '00000000000000000000000000000000';

export default class CASCRemote extends CASC {
	archives = new Map<string, ArchiveEntry>();
	host: string;
	region: string;

	/**
	 * Create a new CASC source using a Blizzard CDN.
	 * @param region - Region tag (eu, us, etc).
	 */
	constructor(region: string) {
		super(true);

		this.region = region;
	}

	/** Initialize remote CASC source. */
	async init(): Promise<void> {
		Log.write('Initializing remote CASC source (%s)', this.region);
		this.host = util.format(Constants.PATCH.HOST, this.region);
		this.builds = [];

		// Collect version configs for all products.
		const promises = Constants.PRODUCTS.map(p => this.getVersionConfig(p.product));
		const results = await Promise.allSettled(promises);

		// Iterate through successful requests and extract product config for our region.
		for (const result of results) {
			if (result.status === 'fulfilled')
				this.builds.push(result.value.find(e => e.Region === this.region));
		}

		Log.write('%o', this.builds);
	}

	/**
	 * Download the remote version config for a specific product.
	 * @param product
	 */
	async getVersionConfig(product: string): Promise<Array<Record<string, string>>> {
		const config = await this.getConfig(product, Constants.PATCH.VERSION_CONFIG);
		config.forEach(entry => entry.Product = product);
		return config;
	}

	/**
	 * Download and parse a version config file.
	 * @param product
	 * @param file
	 */
	async getConfig(product: string, file: string): Promise<Array<Record<string, string>>> {
		const url = this.host + product + file;
		const res = await get(url);

		if (!res.ok)
			throw new Error(util.format('HTTP %d %s from remote CASC endpoint: %s', res.status, res.statusText, url));

		return VersionConfig.parse(await res.text());
	}

	/**
	 * Download and parse a CDN config file.
	 * @param key - CDN config key.
	 * @returns Parsed CDN configuration.
	 */
	async getCDNConfig(key: string): Promise<Record<string, string>> {
		const url = this.host + 'config/' + this.formatCDNKey(key);
		const res = await get(url);

		if (!res.ok)
			throw new Error(util.format('Unable to retrieve CDN config file %s (HTTP %d %s)', key, res.status, res.statusText));

		return ConfigReader.parse(await res.text());
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param fileDataID
	 * @param partialDecryption
	 * @param suppressLog
	 * @param _supportFallback
	 * @param _forceFallback
	 * @param contentKey
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async getFile(fileDataID: number, partialDecrypt = false, suppressLog = false, _supportFallback = true, _forceFallback = false, contentKey = null): Promise<BLTEReader> {
		if (!suppressLog)
			Log.write('Loading remote CASC file %d (%s)', fileDataID, Listfile.getByID(fileDataID) as string);

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getEncodingKey(fileDataID);
		let data = await this.cache.getFile(encodingKey, Constants.CACHE.DIR_DATA);

		if (data === null) {
			const archive = this.archives.get(encodingKey);
			if (archive !== undefined) {
				data = await this.getDataFilePartial(this.formatCDNKey(archive.key), archive.offset, archive.size);

				if (!suppressLog)
					Log.write('Downloading CASC file %d from archive %s', fileDataID, archive.key);
			} else {
				data = await this.getDataFile(this.formatCDNKey(encodingKey));

				if (!suppressLog)
					Log.write('Downloading unarchived CASC file %d', fileDataID);

				if (data === null)
					throw new Error('No remote unarchived/archive indexed for encoding key: ' + encodingKey);
			}

			this.cache.storeFile(encodingKey, data, Constants.CACHE.DIR_DATA);
		} else if (!suppressLog) {
			Log.write('Loaded CASC file %d from cache', fileDataID);
		}

		return new BLTEReader(data, encodingKey, partialDecrypt);
	}

	/**
	 * Returns a list of available products on the remote CDN.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList(): Array<string> {
		const products: Array<string> = [];
		for (const entry of this.builds) {
			const product = Constants.PRODUCTS.find(e => e.product === entry.Product);
			products.push(util.format('%s %s', product?.title ?? 'Unknown', entry.VersionsName));
		}

		return products;
	}

	/**
	 * Preload requirements for reading remote files without initializing the
	 * entire instance. Used by local CASC install for CDN fallback.
	 * @param buildIndex
	 * @param cache
	 */
	async preload(buildIndex: number, cache?: BuildCache): Promise<void> {
		this.build = this.builds[buildIndex];
		Log.write('Preloading remote CASC build: %o', this.build);

		if (cache) {
			this.cache = cache;
		} else {
			this.cache = new BuildCache(this.build.BuildConfig);
			await this.cache.init();
		}

		await this.loadServerConfig();
		await this.resolveCDNHost();
		await this.loadConfigs();
		await this.loadArchives();
	}

	/**
	 * Load the CASC interface with the given build.
	 * @param buildIndex
	 */
	async load(buildIndex: number): Promise<void> {
		this.progress = createProgress(16);
		await this.preload(buildIndex);

		await this.loadEncoding();
		await this.loadRoot();

		state.casc = this;

		await this.loadListfile(this.build.BuildConfig);
		await this.loadTables();
		await this.filterListfile();
		await this.initializeComponents();

		Events.emit('casc:loaded');
	}

	/**
	 * Download and parse the encoding file.
	 */
	async loadEncoding(): Promise<void> {
		const encKeys = this.buildConfig.encoding.split(' ');
		const encKey = encKeys[1];

		Log.timeLog();

		await this.progress.step('Loading encoding table');
		let encRaw = await this.cache.getFile(Constants.CACHE.BUILD_ENCODING);
		if (encRaw === null) {
			// Encoding file not cached, download it.
			Log.write('Encoding for build %s not cached, downloading.', this.cache.key);
			encRaw = await this.getDataFile(this.formatCDNKey(encKey));

			// Store back into cache (no need to block).
			this.cache.storeFile(Constants.CACHE.BUILD_ENCODING, encRaw);
		} else {
			Log.write('Encoding for build %s cached locally.', this.cache.key);
		}

		Log.timeEnd('Loaded encoding table (%s)', filesize(encRaw.length));

		// Parse encoding file.
		Log.timeLog();
		await this.progress.step('Parsing encoding table');
		await this.parseEncodingFile(encRaw, encKey);
		Log.timeEnd('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	/**
	 * Download and parse the root file.
	 */
	async loadRoot(): Promise<void> {
		// Get root key from encoding table.
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		Log.timeLog();
		await this.progress.step('Loading root table');

		let root = await this.cache.getFile(Constants.CACHE.BUILD_ROOT);
		if (root === null) {
			// Root file not cached, download.
			Log.write('Root file for build %s not cached, downloading.', this.cache.key);

			root = await this.getDataFile(this.formatCDNKey(rootKey));
			this.cache.storeFile(Constants.CACHE.BUILD_ROOT, root);
		}

		Log.timeEnd('Loaded root file (%s)', filesize(root.length));

		// Parse root file.
		Log.timeLog();
		await this.progress.step('Parsing root file');
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		Log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	/**
	 * Download and parse archive files.
	 */
	async loadArchives(): Promise<void> {
		// Download archive indexes.
		const archiveKeys = this.cdnConfig.archives.split(' ');
		const archiveCount = archiveKeys.length;

		Log.timeLog();

		if (this.progress)
			await this.progress.step('Loading archives');

		await queue(archiveKeys, key => this.parseArchiveIndex(key as string), 50);

		// Quick and dirty way to get the total archive size using config.
		Log.timeEnd('Loaded %d archives (%d entries)', archiveCount, this.archives.size);
	}

	/**
	 * Download the CDN configuration and store the entry for our
	 * selected region.
	 */
	async loadServerConfig(): Promise<void> {
		if (this.progress)
			await this.progress.step('Fetching CDN configuration');

		// Download CDN server list.
		const serverConfigs = await this.getConfig(this.build.Product, Constants.PATCH.SERVER_CONFIG);
		Log.write('%o', serverConfigs);

		// Locate the CDN entry for our selected region.
		const serverConfig = serverConfigs.find(e => e.Name === this.region);
		if (serverConfig === undefined)
			throw new Error('CDN config does not contain entry for region ' + this.region);

		this.serverConfig = serverConfig;
	}

	/**
	 * Load and parse the contents of an archive index.
	 * Will use global cache and download if missing.
	 * @param key
	 */
	async parseArchiveIndex(key: string): Promise<void> {
		const fileName = key + '.index';

		let data = await this.cache.getFile(fileName, Constants.CACHE.DIR_INDEXES);
		if (data === null) {
			const cdnKey = this.formatCDNKey(key) + '.index';
			data = await this.getDataFile(cdnKey);
			this.cache.storeFile(fileName, data, Constants.CACHE.DIR_INDEXES);
		}

		// Skip to the end of the archive to find the count.
		data.seek(-12);
		const count = data.readInt32() as number;

		if (count * 24 > data.length)
			throw new Error('Unable to parse archive, unexpected size: ' + data.length);

		data.seek(0); // Reset position.

		for (let i = 0; i < count; i++) {
			let hash = data.readString(16, 'hex');

			// Skip zero hashes.
			if (hash === EMPTY_HASH)
				hash = data.readString(16, 'hex');

			this.archives.set(hash, { key, size: data.readInt32BE(), offset: data.readInt32BE() });
		}
	}

	/**
	 * Download a data file from the CDN.
	 * @param {string} file
	 * @returns {BufferWrapper}
	 */
	async getDataFile(file: string): Promise<BufferWrapper> {
		return await downloadFile(this.host + 'data/' + file);
	}

	/**
	 * Download a partial chunk of a data file from the CDN.
	 * @param file
	 * @param ofs
	 * @param len
	 * @returns
	 */
	async getDataFilePartial(file: string, ofs: number, len: number): Promise<BufferWrapper> {
		return await downloadFile(this.host + 'data/' + file, undefined, ofs, len);
	}

	/**
	 * Download the CDNConfig and BuildConfig.
	 */
	async loadConfigs(): Promise<void> {
		// Download CDNConfig and BuildConfig.
		if (this.progress)
			await this.progress.step('Fetching build configurations');

		this.cdnConfig = await this.getCDNConfig(this.build.CDNConfig);
		this.buildConfig = await this.getCDNConfig(this.build.BuildConfig);

		Log.write('CDNConfig: %o', this.cdnConfig);
		Log.write('BuildConfig: %o', this.buildConfig);
	}

	/**
	 * Run a ping for all hosts in the server config and resolve fastest.
	 * Returns NULL if all the hosts failed to ping.
	 */
	async resolveCDNHost(): Promise<void> {
		if (this.progress)
			await this.progress.step('Locating fastest CDN server');

		Log.write('Resolving best host: %s', this.serverConfig.Hosts);

		let bestHost: Host = null;
		const hosts = this.serverConfig.Hosts.split(' ').map(e => 'http://' + e + '/');
		const hostPings: Array<Promise<void>> = [];

		for (const host of hosts) {
			hostPings.push(ping(host).then(ping => {
				Log.write('Host %s resolved with %dms ping', host, ping);
				if (bestHost === null || ping < bestHost.ping)
					bestHost = { host, ping };
			}).catch(e => {
				Log.write('Host %s failed to resolve a ping: %s', host, e);
			}));
		}

		// Ensure that every ping has resolved or failed.
		await Promise.allSettled(hostPings);

		// No hosts resolved.
		if (bestHost === null)
			throw new Error('Unable to resolve a CDN host.');

		Log.write('%s resolved as the fastest host with a ping of %dms', bestHost.host, bestHost.ping);
		this.host = bestHost.host + this.serverConfig.Path + '/';
	}

	/**
	 * Format a CDN key for use in CDN requests.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49/29/49299eae4e3a195953764bb4adb3c91f
	 * @param key
	 */
	formatCDNKey(key: string): string {
		return key.substring(0, 2) + '/' + key.substring(2, 4) + '/' + key;
	}

	/**
	 * Get the current build ID.
	 * @returns
	 */
	getBuildName(): string {
		return this.build.VersionsName;
	}

	/**
	 * Returns the build configuration key.
	 * @returns
	 */
	getBuildKey(): string {
		return this.build.BuildConfig;
	}
}