/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');
const log = require('../log');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');
const CDNConfig = require('./cdn-config');
const BuildCache = require('./build-cache');
const listfile = require('./listfile');
const BLTEReader = require('./blte-reader').BLTEReader;
const BLTEStreamReader = require('./blte-stream-reader');
const cdnResolver = require('./cdn-resolver');

const EMPTY_HASH = '00000000000000000000000000000000';

class CASCRemote extends CASC {
	/**
	 * Create a new CASC source using a Blizzard CDN.
	 * @param {string} region Region tag (eu, us, etc).
	 */
	constructor(region) {
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
		if(this.region === 'cn')
			this.host = constants.PATCH.HOST_CHINA;

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
	 * @param {string} product 
	 */
	async getVersionConfig(product) {
		const config = await this.getConfig(product, constants.PATCH.VERSION_CONFIG);
		config.forEach(entry => entry.Product = product);
		return config;
	}

	/**
	 * Download and parse a version config file.
	 * @param {string} product 
	 * @param {string} file 
	 */
	async getConfig(product, file) {
		const url = this.host + product + file;
		const res = await generics.get(url);

		if (!res.ok)
			throw new Error(util.format('HTTP %d from remote CASC endpoint: %s', res.status, url));

		return VersionConfig(await res.text());
	}

	/**
	 * Download and parse a CDN config file.
	 * Attempts multiple CDN hosts in order of ping speed if one fails.
	 * @param {string} key
	 * @param {Array<string>} [cdnHosts=null] Optional array of CDN hosts to try (in priority order)
	 */
	async getCDNConfig(key, cdnHosts = null) {
		// If no hosts provided, use the current host
		const hostsToTry = cdnHosts || [this.host];

		let lastError = null;
		for (const host of hostsToTry) {
			try {
				const url = host + 'config/' + this.formatCDNKey(key);
				log.write('Attempting to retrieve CDN config from: %s', url);
				const res = await generics.get(url);

				if (!res.ok)
					throw new Error(util.format('HTTP %d from CDN config endpoint', res.status));

				const configText = await res.text();
				const config = CDNConfig(configText);

				if (host !== this.host) {
					log.write('Successfully retrieved config from fallback host: %s', host);
					this.host = host;
				}

				return config;
			} catch (error) {
				log.write('Failed to retrieve CDN config from %s: %s', host, error.message);
				lastError = error;

				cdnResolver.markHostFailed(host);
				continue;
			}
		}

		throw new Error(util.format('Unable to retrieve CDN config file %s from any CDN host. Last error: %s', key, lastError?.message || 'Unknown error'));
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param {number} fileDataID
	 * @param {boolean} [partialDecryption=false]
	 * @param {boolean} [suppressLog=false]
	 * @param {boolean} [supportFallback=true]
	 * @param {boolean} [forceFallback=false]
	 * @param {string} [contentKey=null]
	 */
	// TODO: This could do with being an interface.
	async getFile(fileDataID, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null) {
		if (!suppressLog)
			log.write('Loading remote CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));

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
	 * Get a streaming reader for a file by its fileDataID.
	 * @param {number} fileDataID
	 * @param {boolean} [partialDecrypt=false]
	 * @param {boolean} [suppressLog=false]
	 * @param {string} [contentKey=null]
	 * @returns {BLTEStreamReader}
	 */
	async getFileStream(fileDataID, partialDecrypt = false, suppressLog = false, contentKey = null) {
		if (!suppressLog)
			log.write('Creating stream for remote CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		const archive = this.archives.get(encodingKey);

		// download blte header to parse metadata
		let headerData;
		let baseOffset = 0;

		if (archive !== undefined) {
			// archived file - download first 4kb to get header
			headerData = await this.getDataFilePartial(
				this.formatCDNKey(archive.key),
				archive.offset,
				Math.min(4096, archive.size)
			);
			baseOffset = archive.offset;

			if (!suppressLog)
				log.write('Streaming remote CASC file %d from archive %s', fileDataID, archive.key);
		} else {
			// unarchived file
			headerData = await this.getDataFilePartial(
				this.formatCDNKey(encodingKey),
				0,
				4096
			);

			if (!suppressLog)
				log.write('Streaming unarchived remote CASC file %d', fileDataID);
		}

		const metadata = BLTEReader.parseBLTEHeader(headerData, encodingKey, false);

		// create block fetcher function
		const blockFetcher = async (blockIndex) => {
			const block = metadata.blocks[blockIndex];
			const blockOffset = metadata.dataStart + block.fileOffset;

			if (archive !== undefined) {
				return await this.getDataFilePartial(
					this.formatCDNKey(archive.key),
					baseOffset + blockOffset,
					block.CompSize
				);
			} else {
				return await this.getDataFilePartial(
					this.formatCDNKey(encodingKey),
					blockOffset,
					block.CompSize
				);
			}
		};

		return new BLTEStreamReader(encodingKey, metadata, blockFetcher, partialDecrypt);
	}

	/**
	 * Returns a list of available products on the remote CDN.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products = [];
		for (const entry of this.builds) {
			// This check exists because some regions (e.g. China) may not have all products.
			if (entry === undefined)
				continue;

			const product = constants.PRODUCTS.find(e => e.product === entry.Product);
			const label = util.format('%s %s', product.title, entry.VersionsName);
			const versionMatch = entry.VersionsName.match(/^(\d+)\./);
			const expansionId = versionMatch ? Math.min(parseInt(versionMatch[1]) - 1, 12) : 0;
			products.push({ label, expansionId });
		}

		return products;
	}

	/**
	 * Preload requirements for reading remote files without initializing the
	 * entire instance. Used by local CASC install for CDN fallback.
	 * @param {number} buildIndex
	 * @param {Object} cache
	 */
	async preload(buildIndex, cache = null) {
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
		core.showLoadingScreen(12);
		await this.preload(buildIndex);

		await this.loadEncoding();
		await this.loadRoot();

		core.view.casc = this;

		await this.prepareListfile();
		await this.prepareDBDManifest();
		await this.loadListfile(this.build.BuildConfig);

		core.hideLoadingScreen();
	}

	/**
	 * Download and parse the encoding file.
	 */
	async loadEncoding() {
		const encKeys = this.buildConfig.encoding.split(' ');
		const encKey = encKeys[1];

		log.timeLog();

		await core.progressLoadingScreen('Loading encoding table');
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
		await core.progressLoadingScreen('Parsing encoding table');
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
		await core.progressLoadingScreen('Loading root table');

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
		await core.progressLoadingScreen('Parsing root file');
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

		await core.progressLoadingScreen('Loading archives');
			
		await generics.queue(archiveKeys, async key => await this.parseArchiveIndex(key), 50);

		// Quick and dirty way to get the total archive size using config.
		let archiveTotalSize = this.cdnConfig.archivesIndexSize.split(' ').reduce((sum, e) => sum + Number(e), 0);
		log.timeEnd('Loaded %d archives (%d entries, %s)', archiveCount, this.archives.size, generics.filesize(archiveTotalSize));
	}

	/**
	 * Download the CDN configuration and store the entry for our
	 * selected region.
	 */
	async loadServerConfig() {
		await core.progressLoadingScreen('Fetching CDN configuration');

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
	 * @param {string} key 
	 */
	async parseArchiveIndex(key) {
		const fileName = key + '.index';

		let data = await this.cache.getFile(fileName, constants.CACHE.DIR_INDEXES);
		if (data === null) {
			const cdnKey = this.formatCDNKey(key) + '.index';
			data = await this.getDataFile(cdnKey);
			this.cache.storeFile(fileName, data, constants.CACHE.DIR_INDEXES);
		}

		// Skip to the end of the archive to find the count.
		data.seek(-12);
		const count = data.readInt32LE();

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
	 * @param {string} file 
	 * @param {number} ofs
	 * @param {number} len
	 * @returns {BufferWrapper}
	 */
	async getDataFilePartial(file, ofs, len) {
		return await generics.downloadFile(this.host + 'data/' + file, null, ofs, len);
	}

	/**
	 * Download the CDNConfig and BuildConfig.
	 */
	async loadConfigs() {
		// Download CDNConfig and BuildConfig.
		await core.progressLoadingScreen('Fetching build configurations');

		const cdnHosts = await cdnResolver.getRankedHosts(this.region, this.serverConfig);

		this.cdnConfig = await this.getCDNConfig(this.build.CDNConfig, cdnHosts);
		this.buildConfig = await this.getCDNConfig(this.build.BuildConfig, cdnHosts);

		log.write('CDNConfig: %o', this.cdnConfig);
		log.write('BuildConfig: %o', this.buildConfig);
	}

	/**
	 * Resolve the fastest CDN host for this region and server configuration.
	 */
	async resolveCDNHost() {
		await core.progressLoadingScreen('Locating fastest CDN server');

		this.host = await cdnResolver.getBestHost(this.region, this.serverConfig);
	}


	/**
	 * Format a CDN key for use in CDN requests.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49/29/49299eae4e3a195953764bb4adb3c91f
	 * @param {string} key 
	 */
	formatCDNKey(key) {
		return key.substring(0, 2) + '/' + key.substring(2, 4) + '/' + key;
	}

	/**
	 * ensure file is in cache (unwrapped from BLTE) and return path.
	 * @param {string} encodingKey
	 * @param {number} fileDataID
	 * @param {boolean} suppressLog
	 * @returns {string} path to cached file
	 */
	async _ensureFileInCache(encodingKey, fileDataID, suppressLog) {
		const cacheFileName = encodingKey + '.data';
		const cachedPath = this.cache.getFilePath(cacheFileName, constants.CACHE.DIR_DATA);

		// check if already in cache
		const cached = await this.cache.getFile(cacheFileName, constants.CACHE.DIR_DATA);
		if (cached !== null)
			return cachedPath;

		// retrieve and unwrap from BLTE
		if (!suppressLog)
			log.write('caching file %d (%s) for mmap', fileDataID, listfile.getByID(fileDataID));

		const archive = this.archives.get(encodingKey);
		let data;
		if (archive !== undefined)
			data = await this.getDataFilePartial(this.formatCDNKey(archive.key), archive.offset, archive.size);
		else
			data = await this.getDataFile(this.formatCDNKey(encodingKey));

		const blte = new BLTEReader(data, encodingKey, true);
		blte.processAllBlocks();

		// write to cache
		await this.cache.storeFile(cacheFileName, blte, constants.CACHE.DIR_DATA);

		return cachedPath;
	}

	/**
	 * Get encoding info for a file by fileDataID for CDN streaming.
	 * Returns { enc: string, arc?: { key: string, ofs: number, len: number } }
	 * @param {number} fileDataID
	 * @returns {Promise<{enc: string, arc?: {key: string, ofs: number, len: number}}|null>}
	 */
	async getFileEncodingInfo(fileDataID) {
		try {
			const encodingKey = await super.getFile(fileDataID);
			const archive = this.archives.get(encodingKey);

			if (archive !== undefined)
				return { enc: encodingKey, arc: { key: archive.key, ofs: archive.offset, len: archive.size } };

			return { enc: encodingKey };
		} catch {
			return null;
		}
	}

	/**
	 * Get the current build ID.
	 * @returns {string}
	 */
	getBuildName() {
		return this.build.VersionsName;
	}

	/**
	 * Returns the build configuration key.
	 * @returns {string}
	 */
	getBuildKey() {
		return this.build.BuildConfig;
	}
}

module.exports = CASCRemote;