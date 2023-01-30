/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import * as core from '../core';
import * as generics from '../generics';
import * as log from '../log';
import constants from '../constants';
import * as listfile from './listfile';

import * as VersionConfig from './version-config';
import * as ConfigReader from './config-reader';
import BufferWrapper from '../buffer';
import BuildCache from './build-cache';
import BLTEReader from './blte-reader';

import CASC from './casc-source';

const EMPTY_HASH = '00000000000000000000000000000000';

export default class CASCRemote extends CASC {
	builds: Array<any>; // NIT: Make type for builds
	build: any;
	archives: Map<string, any>;
	host: string;
	region: string;
	cache: BuildCache;

	/**
	 * Create a new CASC source using a Blizzard CDN.
	 * @param region - Region tag (eu, us, etc).
	 */
	constructor(region: string) {
		super(true);

		this.archives = new Map();
		this.region = region;
	}

	/**
	 * Initialize remote CASC source.
	 */
	async init() {
		log.write('Initializing remote CASC source (%s)', this.region);
		this.host = util.format(constants.PATCH.HOST, this.region);
		this.builds = [];

		// Collect version configs for all products.
		const promises = constants.PRODUCTS.map(p => this.getVersionConfig(p.product));
		const results = await Promise.allSettled(promises);

		// Iterate through successful requests and extract product config for our region.
		for (const result of results) {
			if (result.status === 'fulfilled')
				this.builds.push(result.value.find(e => e.Region === this.region));
		}

		log.write('%o', this.builds);
	}

	/**
	 * Download the remote version config for a specific product.
	 * @param product
	 */
	async getVersionConfig(product: string) {
		const config = await this.getConfig(product, constants.PATCH.VERSION_CONFIG);
		config.forEach(entry => entry.Product = product);
		return config;
	}

	/**
	 * Download and parse a version config file.
	 * @param product
	 * @param file
	 */
	async getConfig(product: string, file: string) {
		const url = this.host + product + file;
		const res = await generics.get(url);

		if (!res.ok)
			throw new Error(util.format('HTTP %d %s from remote CASC endpoint: %s', res.status, res.statusText, url));

		return VersionConfig.parse(await res.text());
	}

	/**
	 * Download and parse a CDN config file.
	 * @param key
	 */
	async getCDNConfig(key: string): Promise<any> {
		const url = this.host + 'config/' + this.formatCDNKey(key);
		const res = await generics.get(url);

		if (!res.ok)
			throw new Error(util.format('Unable to retrieve CDN config file %s (HTTP %d %s)', key, res.status, res.statusText));

		return ConfigReader.parse(await res.text());
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
	// TODO: This could do with being an interface.
	// eslint-disable-next-line no-unused-vars
	async getFile(fileDataID, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null) {
		if (!suppressLog)
			log.write('Loading remote CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID) as string);

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		let data = await this.cache.getFile(encodingKey, constants.CACHE.DIR_DATA);

		if (data === null) {
			const archive = this.archives.get(encodingKey);
			if (archive !== undefined) {
				data = await this.getDataFilePartial(this.formatCDNKey(archive.key), archive.offset, archive.size);

				if (!suppressLog)
					log.write('Downloading CASC file %d from archive %s', fileDataID, archive.key);
			} else {
				data = await this.getDataFile(this.formatCDNKey(encodingKey));

				if (!suppressLog)
					log.write('Downloading unarchived CASC file %d', fileDataID);

				if (data === null)
					throw new Error('No remote unarchived/archive indexed for encoding key: ' + encodingKey);
			}

			this.cache.storeFile(encodingKey, data, constants.CACHE.DIR_DATA);
		} else if (!suppressLog) {
			log.write('Loaded CASC file %d from cache', fileDataID);
		}

		return new BLTEReader(data, encodingKey, partialDecrypt);
	}

	/**
	 * Returns a list of available products on the remote CDN.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products: string[] = [];
		for (const entry of this.builds) {
			const product = constants.PRODUCTS.find(e => e.product === entry.Product);
			products.push(util.format('%s %s', product.title, entry.VersionsName));
		}

		return products;
	}

	/**
	 * Preload requirements for reading remote files without initializing the
	 * entire instance. Used by local CASC install for CDN fallback.
	 * @param buildIndex
	 * @param cache
	 */
	async preload(buildIndex: number, cache?: BuildCache) {
		this.build = this.builds[buildIndex];
		log.write('Preloading remote CASC build: %o', this.build);

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
	 * @param {number} buildIndex
	 */
	async load(buildIndex) {
		this.progress = core.createProgress(16);
		await this.preload(buildIndex);

		await this.loadEncoding();
		await this.loadRoot();

		core.view.casc = this;

		await this.loadListfile(this.build.BuildConfig);
		await this.loadTables();
		await this.filterListfile();
		await this.initializeComponents();
	}

	/**
	 * Download and parse the encoding file.
	 */
	async loadEncoding() {
		const encKeys = this.buildConfig.encoding.split(' ');
		const encKey = encKeys[1];

		log.timeLog();

		await this.progress.step('Loading encoding table');
		let encRaw = await this.cache.getFile(constants.CACHE.BUILD_ENCODING);
		if (encRaw === null) {
			// Encoding file not cached, download it.
			log.write('Encoding for build %s not cached, downloading.', this.cache.key);
			encRaw = await this.getDataFile(this.formatCDNKey(encKey));

			// Store back into cache (no need to block).
			this.cache.storeFile(constants.CACHE.BUILD_ENCODING, encRaw);
		} else {
			log.write('Encoding for build %s cached locally.', this.cache.key);
		}

		log.timeEnd('Loaded encoding table (%s)', generics.filesize(encRaw.byteLength));

		// Parse encoding file.
		log.timeLog();
		await this.progress.step('Parsing encoding table');
		await this.parseEncodingFile(encRaw, encKey);
		log.timeEnd('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	/**
	 * Download and parse the root file.
	 */
	async loadRoot() {
		// Get root key from encoding table.
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		log.timeLog();
		await this.progress.step('Loading root table');

		let root = await this.cache.getFile(constants.CACHE.BUILD_ROOT);
		if (root === null) {
			// Root file not cached, download.
			log.write('Root file for build %s not cached, downloading.', this.cache.key);

			root = await this.getDataFile(this.formatCDNKey(rootKey));
			this.cache.storeFile(constants.CACHE.BUILD_ROOT, root);
		}

		log.timeEnd('Loaded root file (%s)', generics.filesize(root.byteLength));

		// Parse root file.
		log.timeLog();
		await this.progress.step('Parsing root file');
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	/**
	 * Download and parse archive files.
	 */
	async loadArchives() {
		// Download archive indexes.
		const archiveKeys = this.cdnConfig.archives.split(' ');
		const archiveCount = archiveKeys.length;

		log.timeLog();

		if (this.progress)
			await this.progress.step('Loading archives');

		await generics.queue(archiveKeys, key => this.parseArchiveIndex(key as string), 50);

		// Quick and dirty way to get the total archive size using config.
		const archiveTotalSize = this.cdnConfig.archivesIndexSize.split(' ').reduce((x, e) => Number(x) + Number(e));
		log.timeEnd('Loaded %d archives (%d entries, %s)', archiveCount, this.archives.size, generics.filesize(archiveTotalSize));
	}

	/**
	 * Download the CDN configuration and store the entry for our
	 * selected region.
	 */
	async loadServerConfig() {
		if (this.progress)
			await this.progress.step('Fetching CDN configuration');

		// Download CDN server list.
		const serverConfigs = await this.getConfig(this.build.Product, constants.PATCH.SERVER_CONFIG);
		log.write('%o', serverConfigs);

		// Locate the CDN entry for our selected region.
		this.serverConfig = serverConfigs.find(e => e.Name === this.region);
		if (!this.serverConfig)
			throw new Error('CDN config does not contain entry for region ' + this.region);
	}

	/**
	 * Load and parse the contents of an archive index.
	 * Will use global cache and download if missing.
	 * @param key
	 */
	async parseArchiveIndex(key: string) {
		const fileName = key + '.index';

		let data = await this.cache.getFile(fileName, constants.CACHE.DIR_INDEXES);
		if (data === null) {
			const cdnKey = this.formatCDNKey(key) + '.index';
			data = await this.getDataFile(cdnKey);
			this.cache.storeFile(fileName, data, constants.CACHE.DIR_INDEXES);
		}

		// Skip to the end of the archive to find the count.
		data.seek(-12);
		const count = data.readInt32LE() as number;

		if (count * 24 > data.byteLength)
			throw new Error('Unable to parse archive, unexpected size: ' + data.byteLength);

		data.seek(0); // Reset position.

		for (let i = 0; i < count; i++) {
			let hash = data.readHexString(16);

			// Skip zero hashes.
			if (hash === EMPTY_HASH)
				hash = data.readHexString(16);

			this.archives.set(hash, { key, size: data.readInt32BE(), offset: data.readInt32BE() });
		}
	}

	/**
	 * Download a data file from the CDN.
	 * @param {string} file
	 * @returns {BufferWrapper}
	 */
	async getDataFile(file) {
		return await generics.downloadFile(this.host + 'data/' + file);
	}

	/**
	 * Download a partial chunk of a data file from the CDN.
	 * @param file
	 * @param ofs
	 * @param len
	 * @returns
	 */
	async getDataFilePartial(file: string, ofs: number, len: number): Promise<BufferWrapper> {
		return await generics.downloadFile(this.host + 'data/' + file, undefined, ofs, len);
	}

	/**
	 * Download the CDNConfig and BuildConfig.
	 */
	async loadConfigs() {
		// Download CDNConfig and BuildConfig.
		if (this.progress)
			await this.progress.step('Fetching build configurations');

		this.cdnConfig = await this.getCDNConfig(this.build.CDNConfig);
		this.buildConfig = await this.getCDNConfig(this.build.BuildConfig);

		log.write('CDNConfig: %o', this.cdnConfig);
		log.write('BuildConfig: %o', this.buildConfig);
	}

	/**
	 * Run a ping for all hosts in the server config and resolve fastest.
	 * Returns NULL if all the hosts failed to ping.
	 */
	async resolveCDNHost() {
		if (this.progress)
			await this.progress.step('Locating fastest CDN server');

		log.write('Resolving best host: %s', this.serverConfig.Hosts);

		let bestHost: any = null;
		const hosts = this.serverConfig.Hosts.split(' ').map(e => 'http://' + e + '/');
		const hostPings: Array<Promise<void>> = [];

		for (const host of hosts) {
			hostPings.push(generics.ping(host).then(ping => {
				log.write('Host %s resolved with %dms ping', host, ping);
				if (bestHost === null || ping < bestHost.ping)
					bestHost = { host, ping };
			}).catch(e => {
				log.write('Host %s failed to resolve a ping: %s', host, e);
			}));
		}

		// Ensure that every ping has resolved or failed.
		await Promise.allSettled(hostPings);

		// No hosts resolved.
		if (bestHost === null)
			throw new Error('Unable to resolve a CDN host.');

		log.write('%s resolved as the fastest host with a ping of %dms', bestHost.host, bestHost.ping);
		this.host = bestHost.host + this.serverConfig.Path + '/';
	}

	/**
	 * Format a CDN key for use in CDN requests.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49/29/49299eae4e3a195953764bb4adb3c91f
	 * @param key
	 */
	formatCDNKey(key: string) {
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