import path from 'node:path';
import fsp from 'node:fs/promises';
import util from 'node:util';
import * as log from '../lib/log.js';
import * as constants from '../lib/constants.js';
import CASC from './casc-source.js';
import VersionConfig from './version-config.js';
import CDNConfig from './cdn-config.js';
import BufferWrapper from '../lib/buffer.js';
import { BuildCache } from './build-cache.js';
import { BLTEReader } from './blte-reader.js';
import BLTEStreamReader from './blte-stream-reader.js';
import * as listfile from './listfile.js';
import * as core from '../lib/core.js';
import * as generics from '../lib/generics.js';
import CASCRemote from './casc-source-remote.js';
import * as cdnResolver from './cdn-resolver.js';

class CASCLocal extends CASC {
	constructor(dir) {
		super(false);

		this.dir = dir;
		this.dataDir = path.join(dir, constants.BUILD.DATA_DIR);
		this.storageDir = path.join(this.dataDir, 'data');

		this.localIndexes = new Map();
	}

	async init() {
		log.write('Initializing local CASC installation: %s', this.dir);

		const buildInfo = path.join(this.dir, constants.BUILD.MANIFEST);
		const config = VersionConfig(await fsp.readFile(buildInfo, 'utf8'));

		this.builds = config.filter(entry => constants.PRODUCTS.some(e => e.product === entry.Product));

		log.write('%o', this.builds);
	}

	async getFile(fileDataID, partialDecryption = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null) {
		if (!suppressLog)
			log.write('Loading local CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		const data = supportFallback ? await this.getDataFileWithRemoteFallback(encodingKey, forceFallback) : await this.getDataFile(encodingKey);
		return new BLTEReader(data, encodingKey, partialDecryption);
	}

	async getFileStream(fileDataID, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false, contentKey = null) {
		if (!suppressLog)
			log.write('Creating stream for local CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));

		if (forceFallback || !supportFallback) {
			if (!this.remote)
				await this.initializeRemoteCASC();

			return await this.remote.getFileStream(fileDataID, partialDecrypt, suppressLog, contentKey);
		}

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		const entry = this.localIndexes.get(encodingKey.substring(0, 18));

		if (!entry) {
			if (!supportFallback)
				throw new Error('file does not exist in local data: ' + encodingKey);

			if (!this.remote)
				await this.initializeRemoteCASC();

			return await this.remote.getFileStream(fileDataID, partialDecrypt, suppressLog, contentKey);
		}

		const headerData = await generics.readFile(
			this.formatDataPath(entry.index),
			entry.offset + 0x1e,
			Math.min(4096, entry.size - 0x1e)
		);

		if (!BLTEReader.check(headerData)) {
			if (!supportFallback)
				throw new Error('local data file is not a valid BLTE');

			if (!this.remote)
				await this.initializeRemoteCASC();

			return await this.remote.getFileStream(fileDataID, partialDecrypt, suppressLog, contentKey);
		}

		const metadata = BLTEReader.parseBLTEHeader(headerData, encodingKey, false);

		const blockFetcher = async (blockIndex) => {
			const block = metadata.blocks[blockIndex];
			const blockOffset = metadata.dataStart + block.fileOffset;

			return await generics.readFile(
				this.formatDataPath(entry.index),
				entry.offset + 0x1e + blockOffset,
				block.CompSize
			);
		};

		return new BLTEStreamReader(encodingKey, metadata, blockFetcher, partialDecrypt);
	}

	getProductList() {
		const products = [];
		for (let i = 0; i < this.builds.length; i++) {
			const entry = this.builds[i];
			const product = constants.PRODUCTS.find(e => e.product === entry.Product);
			const label = util.format('%s (%s) %s', product.title, entry.Branch.toUpperCase(), entry.Version);
			const versionMatch = entry.Version.match(/^(\d+)\./);
			const expansionId = versionMatch ? Math.min(parseInt(versionMatch[1]) - 1, 12) : 0;
			products.push({ label, expansionId, buildIndex: i });
		}

		return products;
	}

	async load(buildIndex) {
		this.build = this.builds[buildIndex];
		log.write('Loading local CASC build: %o', this.build);

		this.cache = new BuildCache(this.build.BuildKey);
		await this.cache.init();

		core.show_loading_screen(10);

		await this.loadConfigs();
		await this.loadIndexes();
		await this.loadEncoding();
		await this.loadRoot();

		core.set_casc(this);

		await this.prepareListfile();
		await this.prepareDBDManifest();
		await this.loadListfile(this.build.BuildKey);

		core.hide_loading_screen();
	}

	async loadConfigs() {
		await core.progress_loading_screen('Fetching build configurations');

		if (await generics.fileExists('fakebuildconfig')) {
			this.buildConfig = CDNConfig(await fsp.readFile('fakebuildconfig', 'utf8'));
			log.write('WARNING: Using fake build config. No support given for weird stuff happening.');

			const splitName = this.buildConfig.buildName.split('patch');
			const buildNumber = splitName[0].replace('WOW-', '');
			const splitPatch = splitName[1].split('_');

			this.build.Version = splitPatch[0] + '.' + buildNumber;
		} else {
			this.buildConfig = await this.getConfigFileWithRemoteFallback(this.build.BuildKey);
		}

		this.cdnConfig = await this.getConfigFileWithRemoteFallback(this.build.CDNKey);

		log.write('BuildConfig: %o', this.buildConfig);
		log.write('CDNConfig: %o', this.cdnConfig);
	}

	async getConfigFileWithRemoteFallback(key) {
		const configPath = this.formatConfigPath(key);
		if (!await generics.fileExists(configPath)) {
			log.write('Local config file %s does not exist, falling back to CDN...', key);
			if (!this.remote)
				await this.initializeRemoteCASC();

			const cdnHosts = await cdnResolver.getRankedHosts(core.get_selected_cdn_region(), this.remote.serverConfig);
			return this.remote.getCDNConfig(key, cdnHosts);
		} else {
			return CDNConfig(await fsp.readFile(configPath, 'utf8'));
		}
	}

	async loadIndexes() {
		log.time_log();
		await core.progress_loading_screen('Loading indexes');

		let indexCount = 0;

		const entries = await fsp.readdir(this.storageDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith('.idx')) {
				await this.parseIndex(path.join(this.storageDir, entry.name));
				indexCount++;
			}
		}

		log.time_end('Loaded %d entries from %d journal indexes', this.localIndexes.size, indexCount);
	}

	async parseIndex(file) {
		const entries = this.localIndexes;
		const index = await BufferWrapper.readFile(file);

		const headerHashSize = index.readInt32LE();
		index.move(4);
		index.move(headerHashSize);

		index.seek((8 + headerHashSize + 0x0F) & 0xFFFFFFF0);

		const dataLength = index.readInt32LE();
		index.move(4);

		const nBlocks = dataLength / 18;
		for (let i = 0; i < nBlocks; i++) {
			const key = index.readHexString(9);
			if (entries.has(key)) {
				index.move(1 + 4 + 4);
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

	async loadEncoding() {
		log.time_log();
		const encKeys = this.buildConfig.encoding.split(' ');

		await core.progress_loading_screen('Loading encoding table');
		const encRaw = await this.getDataFileWithRemoteFallback(encKeys[1]);
		await this.parseEncodingFile(encRaw, encKeys[1]);
		log.time_end('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	async loadRoot() {
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		log.time_log();
		await core.progress_loading_screen('Loading root file');
		const root = await this.getDataFileWithRemoteFallback(rootKey);
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.time_end('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	async initializeRemoteCASC() {
		const remote = new CASCRemote(core.get_selected_cdn_region());
		await remote.init();

		const buildIndex = remote.builds.findIndex(build => build.Product === this.build.Product);
		await remote.preload(buildIndex, this.cache);

		this.remote = remote;
	}

	async getDataFileWithRemoteFallback(key, forceFallback = false) {
		try {
			if (forceFallback)
				throw new Error('Local data is corrupted, forceFallback set.');

			const local = await this.getDataFile(key);

			if (!BLTEReader.check(local))
				throw new Error('Local data file is not a valid BLTE');

			return local;
		} catch (e) {
			log.write('Local data file %s does not exist, falling back to cache...', key);
			const cached = await this.cache.getFile(key, constants.CACHE.DIR_DATA);
			if (cached !== null)
				return cached;

			log.write('Local data file %s not cached, falling back to CDN...', key);
			if (!this.remote)
				await this.initializeRemoteCASC();

			const archive = this.remote.archives.get(key);
			let data;
			if (archive !== undefined) {
				log.write('Local data file %s has archive, attempt partial download...', key);
				data = await this.remote.getDataFilePartial(this.remote.formatCDNKey(archive.key), archive.offset, archive.size);
			} else {
				log.write('Local data file %s has no archive, attempting direct download...', key);
				data = await this.remote.getDataFile(this.remote.formatCDNKey(key));
			}

			this.cache.storeFile(key, data, constants.CACHE.DIR_DATA);
			return data;
		}
	}

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

	formatDataPath(id) {
		return path.join(this.dataDir, 'data', 'data.' + id.toString().padStart(3, '0'));
	}

	formatIndexPath(key) {
		return path.join(this.dataDir, 'indices', key + '.index');
	}

	formatConfigPath(key) {
		return path.join(this.dataDir, 'config', this.formatCDNKey(key));
	}

	formatCDNKey(key) {
		return path.join(key.substring(0, 2), key.substring(2, 4), key);
	}

	async _ensureFileInCache(encodingKey, fileDataID, suppressLog) {
		const cacheFileName = encodingKey + '.data';
		const cachedPath = this.cache.getFilePath(cacheFileName, constants.CACHE.DIR_DATA);

		const cached = await this.cache.getFile(cacheFileName, constants.CACHE.DIR_DATA);
		if (cached !== null)
			return cachedPath;

		if (!suppressLog)
			log.write('caching file %d (%s) for mmap', fileDataID, listfile.getByID(fileDataID));

		const data = await this.getDataFileWithRemoteFallback(encodingKey);
		const blte = new BLTEReader(data, encodingKey, true);
		blte.processAllBlocks();

		await this.cache.storeFile(cacheFileName, blte, constants.CACHE.DIR_DATA);

		return cachedPath;
	}

	async getFileEncodingInfo(fileDataID) {
		try {
			const encodingKey = await super.getFile(fileDataID);

			if (!this.remote)
				await this.initializeRemoteCASC();

			const archive = this.remote.archives.get(encodingKey);
			if (archive !== undefined)
				return { enc: encodingKey, arc: { key: archive.key, ofs: archive.offset, len: archive.size } };

			return { enc: encodingKey };
		} catch {
			return null;
		}
	}

	getBuildName() {
		return this.build.Version;
	}

	getBuildKey() {
		return this.build.BuildKey;
	}
}

export default CASCLocal;
