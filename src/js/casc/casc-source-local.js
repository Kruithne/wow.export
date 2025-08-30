/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const fsp = require('fs').promises;
const util = require('util');
const log = require('../log');
const constants = require('../constants');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');
const CDNConfig = require('./cdn-config');
const BufferWrapper = require('../buffer');
const BuildCache = require('./build-cache');
const BLTEReader = require('./blte-reader').BLTEReader;
const listfile = require('./listfile');
const core = require('../core');
const generics = require('../generics');
const CASCRemote = require('./casc-source-remote');

class CASCLocal extends CASC {
	/**
	 * Create a new CASC source using a local installation.
	 * @param {string} dir Installation path.
	 */
	constructor(dir) {
		super(false);

		this.dir = dir;
		this.dataDir = path.join(dir, constants.BUILD.DATA_DIR);
		this.storageDir = path.join(this.dataDir, 'data');

		this.localIndexes = new Map();
	}

	/**
	 * Initialize local CASC source.
	 */
	async init() {
		log.write('Initializing local CASC installation: %s', this.dir);

		const buildInfo = path.join(this.dir, constants.BUILD.MANIFEST);
		const config = VersionConfig(await fsp.readFile(buildInfo, 'utf8'));

		// Filter known products.
		this.builds = config.filter(entry => constants.PRODUCTS.some(e => e.product === entry.Product));

		log.write('%o', this.builds);
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
	async getFile(fileDataID, partialDecryption = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null) {
		if (!suppressLog)
			log.write('Loading local CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));
			
		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		const data = supportFallback ? await this.getDataFileWithRemoteFallback(encodingKey, forceFallback) : await this.getDataFile(encodingKey);
		return new BLTEReader(data, encodingKey, partialDecryption);
	}

	/**
	 * Returns a list of available products in the installation.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products = [];
		for (const entry of this.builds) {
			const product = constants.PRODUCTS.find(e => e.product === entry.Product);
			products.push(util.format('%s (%s) %s', product.title, entry.Branch.toUpperCase(), entry.Version));
		}

		return products;
	}

	/**
	 * Load the CASC interface with the given build.
	 * @param {number} buildIndex
	 */
	async load(buildIndex) {
		this.build = this.builds[buildIndex];
		log.write('Loading local CASC build: %o', this.build);

		this.cache = new BuildCache(this.build.BuildKey);
		await this.cache.init();

		this.progress = core.createProgress(13);
		await this.loadConfigs();
		await this.loadIndexes();
		await this.loadEncoding();
		await this.loadRoot();

		core.view.casc = this;

		await this.loadListfile(this.build.BuildKey);
		await this.loadTables();
		await this.filterListfile();
		await this.initializeComponents();
	}

	/**
	 * Load the BuildConfig from the installation directory.
	 */
	async loadConfigs() {
		// Load and parse configs from disk with CDN fallback.
		await this.progress.step('Fetching build configurations');

		if (await generics.fileExists("fakebuildconfig")) {
			this.buildConfig = CDNConfig(await fsp.readFile("fakebuildconfig", 'utf8'));
			log.write("WARNING: Using fake build config. No support given for weird stuff happening.");

			// Reconstruct version from the fake config's build name.
			// This is used for e.g. DBD version selection so needs to be correct.
			const splitName = this.buildConfig.buildName.split("patch");
			const buildNumber = splitName[0].replace("WOW-", "");
			const splitPatch = splitName[1].split("_");
			
			this.build.Version = splitPatch[0] + "." + buildNumber;
		} else {
			this.buildConfig = await this.getConfigFileWithRemoteFallback(this.build.BuildKey);
		}
		
		this.cdnConfig = await this.getConfigFileWithRemoteFallback(this.build.CDNKey);

		log.write('BuildConfig: %o', this.buildConfig);
		log.write('CDNConfig: %o', this.cdnConfig);
	}

	/** 
	 * Get config from disk with CDN fallback 
	 */
	async getConfigFileWithRemoteFallback(key) {
		const configPath = this.formatConfigPath(key);
		if (!await generics.fileExists(configPath)) {
			log.write('Local config file %s does not exist, falling back to CDN...', key);
			if (!this.remote)
				await this.initializeRemoteCASC();

			return this.remote.getCDNConfig(key);
		} else {
			return CDNConfig(await fsp.readFile(configPath, 'utf8'));
		}
	}

	/**
	 * Load and parse storage indexes from the local installation.
	 */
	async loadIndexes() {
		log.timeLog();
		await this.progress.step('Loading indexes');

		let indexCount = 0;

		const entries = await fsp.readdir(this.storageDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.idx')) {
				await this.parseIndex(path.join(this.storageDir, entry.name));
				indexCount++;
			}
		}

		log.timeEnd('Loaded %d entries from %d journal indexes', this.localIndexes.size, indexCount);
	}

	/**
	 * Parse a local installation journal index for entries.
	 * @param {string} file Path to the index.
	 */
	async parseIndex(file) {
		const entries = this.localIndexes;
		const index = await BufferWrapper.readFile(file);

		const headerHashSize = index.readInt32LE();
		index.move(4); // headerHash uint32
		index.move(headerHashSize); // headerHash byte[headerHashSize]

		index.seek((8 + headerHashSize + 0x0F) & 0xFFFFFFF0); // Next 0x10 boundary.

		const dataLength = index.readInt32LE();
		index.move(4);

		const nBlocks = dataLength / 18;
		for (let i = 0; i < nBlocks; i++) {
			const key = index.readHexString(9);
			if (entries.has(key)) {
				index.move(1 + 4 + 4); // idxHigh + idxLow + size
				continue;
			}

			const idxHigh = index.readUInt8();
			const idxLow = index.readInt32BE();

			entries.set(key, {
				index: (idxHigh << 2 | ((idxLow & 0xC0000000) >>> 30)),
				offset: idxLow & 0x3FFFFFFF,
				size: index.readInt32LE()
			});
		}
	}

	/**
	 * Load and parse encoding from the local installation.
	 */
	async loadEncoding() {
		// Parse encoding file.
		log.timeLog();
		const encKeys = this.buildConfig.encoding.split(' ');

		await this.progress.step('Loading encoding table');
		const encRaw = await this.getDataFileWithRemoteFallback(encKeys[1]);
		await this.parseEncodingFile(encRaw, encKeys[1]);
		log.timeEnd('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	/**
	 * Load and parse root table from local installation.
	 */
	async loadRoot() {
		// Get root key from encoding table.
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		// Parse root file.
		log.timeLog();
		await this.progress.step('Loading root file');
		const root = await this.getDataFileWithRemoteFallback(rootKey);
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	/**
	 * Initialize a remote CASC instance to download missing
	 * files needed during local initialization.
	 */
	async initializeRemoteCASC() {
		const remote = new CASCRemote(core.view.selectedCDNRegion.tag);
		await remote.init();

		const buildIndex = remote.builds.findIndex(build => build.Product === this.build.Product);
		await remote.preload(buildIndex, this.cache);

		this.remote = remote;
	}

	/**
	 * Obtain a data file from the local archives.
	 * If not stored locally, file will be downloaded from a CDN.
	 * @param {string} key 
	 * @param {boolean} [forceFallback=false]
	 */
	async getDataFileWithRemoteFallback(key, forceFallback = false) {
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
			log.write('Local data file %s does not exist, falling back to cache...', key);
			const cached = await this.cache.getFile(key, constants.CACHE.DIR_DATA);
			if (cached !== null)
				return cached;

			// Attempt 3: Download from CDN.
			log.write('Local data file %s not cached, falling back to CDN...', key);
			if (!this.remote)
				await this.initializeRemoteCASC();

			const archive = this.remote.archives.get(key);
			let data;
			if (archive !== undefined) {
				// Archive exists for key, attempt partial remote download.
				log.write('Local data file %s has archive, attempt partial download...', key);
				data = await this.remote.getDataFilePartial(this.remote.formatCDNKey(archive.key), archive.offset, archive.size);
			} else {
				// No archive for this file, attempt direct download.
				log.write('Local data file %s has no archive, attempting direct download...', key);
				data = await this.remote.getDataFile(this.remote.formatCDNKey(key));
			}

			this.cache.storeFile(key, data, constants.CACHE.DIR_DATA);
			return data;
		}
	}

	/**
	 * Obtain a data file from the local archives.
	 * @param {string} key
	 */
	async getDataFile(key) {
		const entry = this.localIndexes.get(key.substring(0, 18));
		if (!entry)
			throw new Error('Requested file does not exist in local data: ' + key);

		const data = await generics.readFile(this.formatDataPath(entry.index), entry.offset + 0x1E, entry.size - 0x1E);

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
	 * @param {number} id 
	 */
	formatDataPath(id) {
		return path.join(this.dataDir, 'data', 'data.' + id.toString().padStart(3, '0'));
	}

	/**
	 * Format a local path to an archive index from the key.
	 * 0b45bd2721fd6c86dac2176cbdb7fc5b -> <install>/Data/indices/0b45bd2721fd6c86dac2176cbdb7fc5b.index
	 * @param {string} key 
	 */
	formatIndexPath(key) {
		return path.join(this.dataDir, 'indices', key + '.index');
	}

	/**
	 * Format a local path to a config file from the key.
	 * 0af716e8eca5aeff0a3965d37e934ffa -> <install>/Data/config/0a/f7/0af716e8eca5aeff0a3965d37e934ffa
	 * @param {string} key 
	 */
	formatConfigPath(key) {
		return path.join(this.dataDir, 'config', this.formatCDNKey(key));
	}

	/**
	 * Format a CDN key for use in local file reading.
	 * Path separators used by this method are platform specific.
	 * 49299eae4e3a195953764bb4adb3c91f -> 49\29\49299eae4e3a195953764bb4adb3c91f
	 * @param {string} key 
	 */
	formatCDNKey(key) {
		return path.join(key.substring(0, 2), key.substring(2, 4), key);
	}

	/**
	* Get the current build ID.
	* @returns {string}
	*/
	getBuildName() {
		return this.build.Version;
	}

	/**
	 * Returns the build configuration key.
	 * @returns {string}
	 */
	getBuildKey() {
		return this.build.BuildKey;
	}
}

module.exports = CASCLocal;