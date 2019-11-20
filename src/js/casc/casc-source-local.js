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
const BLTEReader = require('./blte-reader');
const listfile = require('./listfile');

class CASCLocal extends CASC {
	/**
	 * Create a new CASC source using a local installation.
	 * @param {string} dir Installation path.
	 */
	constructor(dir) {
		super();

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
		this.builds = config.filter(entry => constants.PRODUCTS.hasOwnProperty(entry.Product));

		log.write('%o', this.builds);
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param {number} fileDataID 
	 */
	async getFile(fileDataID) {
		log.write('Loading local CASC file %d', fileDataID);
		const encodingKey = await super.getFile(fileDataID);
		return new BLTEReader(await this.getDataFile(encodingKey), encodingKey);
	}

	/**
	 * Returns a list of available products in the installation.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products = [];
		for (const entry of this.builds)
			products.push(util.format('%s (%s) %s', constants.PRODUCTS[entry.Product], entry.Branch.toUpperCase(), entry.Version));

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

		this.progress = core.createProgress(6);
		await this.loadConfigs();
		await this.loadIndexes();
		await this.loadEncoding();
		await this.loadRoot();
		await this.loadListfile();
	}

	/**
	 * Load the BuildConfig from the installation directory.
	 */
	async loadConfigs() {
		// Load and parse BuildConfig from disk.
		await this.progress.step('Fetching build configurations');
		this.buildConfig = CDNConfig(await fsp.readFile(this.formatConfigPath(this.build.BuildKey), 'utf8'));
		this.cdnConfig = CDNConfig(await fsp.readFile(this.formatConfigPath(this.build.CDNKey), 'utf8'));

		log.write('BuildConfig: %o', this.buildConfig);
		log.write('CDNConfig: %o', this.cdnConfig);
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
		const encRaw = await this.getDataFile(encKeys[1]);
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
		await this.progress.step('Parsing root file');
		const root = await this.getDataFile(rootKey);
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.timeEnd('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	
	/**
	 * Load the listfile for selected build.
	 */
	async loadListfile() {
		await this.progress.step('Loading listfile');
		const entries = await listfile.loadListfile(this.build.BuildKey, this.cache);
		if (entries === 0)
			throw new Error('No listfile entries found');
	}

	/**
	 * Obtain a data file from the local archives.
	 * @param {string} key
	 */
	async getDataFile(key) {
		const entry = this.localIndexes.get(key.substring(0, 18));
		if (!entry)
			throw new Error('Requested file does not exist in local data: ' + key);

		return await generics.readFile(this.formatDataPath(entry.index), entry.offset + 0x1E, entry.size - 0x1E);
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
}

module.exports = CASCLocal;