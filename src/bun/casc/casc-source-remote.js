import util from 'node:util';
import * as constants from '../lib/constants.js';
import * as generics from '../lib/generics.js';
import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import CASC from './casc-source.js';
import VersionConfig from './version-config.js';
import CDNConfig from './cdn-config.js';
import { BuildCache } from './build-cache.js';
import * as listfile from './listfile.js';
import { BLTEReader } from './blte-reader.js';
import BLTEStreamReader from './blte-stream-reader.js';
import cdnResolver from './cdn-resolver.js';

const EMPTY_HASH = '00000000000000000000000000000000';

class CASCRemote extends CASC {
	constructor(region) {
		super(true);

		this.archives = new Map();
		this.region = region;
	}

	async init() {
		log.write('Initializing remote CASC source (%s)', this.region);
		this.host = util.format(constants.PATCH.HOST, this.region);
		if (this.region === 'cn')
			this.host = constants.PATCH.HOST_CHINA;

		this.builds = [];

		const promises = constants.PRODUCTS.map(p => this.getVersionConfig(p.product));
		const results = await Promise.allSettled(promises);

		for (const result of results) {
			if (result.status === 'fulfilled')
				this.builds.push(result.value.find(e => e.Region === this.region));
		}

		log.write('%o', this.builds);
	}

	async getVersionConfig(product) {
		const config = await this.getConfig(product, constants.PATCH.VERSION_CONFIG);
		config.forEach(entry => entry.Product = product);
		return config;
	}

	async getConfig(product, file) {
		const url = this.host + product + file;
		const res = await generics.get(url);

		if (!res.ok)
			throw new Error(util.format('HTTP %d from remote CASC endpoint: %s', res.status, url));

		return VersionConfig(await res.text());
	}

	async getCDNConfig(key, cdnHosts = null) {
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

	async getFileStream(fileDataID, partialDecrypt = false, suppressLog = false, contentKey = null) {
		if (!suppressLog)
			log.write('Creating stream for remote CASC file %d (%s)', fileDataID, listfile.getByID(fileDataID));

		const encodingKey = contentKey !== null ? super.getEncodingKeyForContentKey(contentKey) : await super.getFile(fileDataID);
		const archive = this.archives.get(encodingKey);

		let headerData;
		let baseOffset = 0;

		if (archive !== undefined) {
			headerData = await this.getDataFilePartial(
				this.formatCDNKey(archive.key),
				archive.offset,
				Math.min(4096, archive.size)
			);
			baseOffset = archive.offset;

			if (!suppressLog)
				log.write('Streaming remote CASC file %d from archive %s', fileDataID, archive.key);
		} else {
			headerData = await this.getDataFilePartial(
				this.formatCDNKey(encodingKey),
				0,
				4096
			);

			if (!suppressLog)
				log.write('Streaming unarchived remote CASC file %d', fileDataID);
		}

		const metadata = BLTEReader.parseBLTEHeader(headerData, encodingKey, false);

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

	getProductList() {
		const products = [];
		for (let i = 0; i < this.builds.length; i++) {
			const entry = this.builds[i];

			if (entry === undefined)
				continue;

			const product = constants.PRODUCTS.find(e => e.product === entry.Product);
			const label = util.format('%s %s', product.title, entry.VersionsName);
			const versionMatch = entry.VersionsName.match(/^(\d+)\./);
			const expansionId = versionMatch ? Math.min(parseInt(versionMatch[1]) - 1, 12) : 0;
			products.push({ label, expansionId, buildIndex: i });
		}

		return products;
	}

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

	async load(buildIndex) {
		await this.preload(buildIndex);

		await this.loadEncoding();
		await this.loadRoot();

		core.set_casc(this);

		await this.prepareListfile();
		await this.prepareDBDManifest();
		await this.loadListfile(this.build.BuildConfig);

		core.hide_loading_screen();
	}

	async loadEncoding() {
		const encKeys = this.buildConfig.encoding.split(' ');
		const encKey = encKeys[1];

		log.time_log();

		await core.progress_loading_screen('Loading encoding table');
		let encRaw = await this.cache.getFile(constants.CACHE.BUILD_ENCODING);
		if (encRaw === null) {
			log.write('Encoding for build %s not cached, downloading.', this.cache.key);
			encRaw = await this.getDataFile(this.formatCDNKey(encKey));

			this.cache.storeFile(constants.CACHE.BUILD_ENCODING, encRaw);
		} else {
			log.write('Encoding for build %s cached locally.', this.cache.key);
		}

		log.time_end('Loaded encoding table (%s)', generics.filesize(encRaw.byteLength));

		log.time_log();
		await core.progress_loading_screen('Parsing encoding table');
		await this.parseEncodingFile(encRaw, encKey);
		log.time_end('Parsed encoding table (%d entries)', this.encodingKeys.size);
	}

	async loadRoot() {
		const rootKey = this.encodingKeys.get(this.buildConfig.root);
		if (rootKey === undefined)
			throw new Error('No encoding entry found for root key');

		log.time_log();
		await core.progress_loading_screen('Loading root table');

		let root = await this.cache.getFile(constants.CACHE.BUILD_ROOT);
		if (root === null) {
			log.write('Root file for build %s not cached, downloading.', this.cache.key);

			root = await this.getDataFile(this.formatCDNKey(rootKey));
			this.cache.storeFile(constants.CACHE.BUILD_ROOT, root);
		}

		log.time_end('Loaded root file (%s)', generics.filesize(root.byteLength));

		log.time_log();
		await core.progress_loading_screen('Parsing root file');
		const rootEntryCount = await this.parseRootFile(root, rootKey);
		log.time_end('Parsed root file (%d entries, %d types)', rootEntryCount, this.rootTypes.length);
	}

	async loadArchives() {
		const archiveKeys = this.cdnConfig.archives.split(' ');
		const archiveCount = archiveKeys.length;

		log.time_log();

		await core.progress_loading_screen('Loading archives');

		await generics.queue(archiveKeys, async key => await this.parseArchiveIndex(key), 50);

		let archiveTotalSize = this.cdnConfig.archivesIndexSize.split(' ').reduce((sum, e) => sum + Number(e), 0);
		log.time_end('Loaded %d archives (%d entries, %s)', archiveCount, this.archives.size, generics.filesize(archiveTotalSize));
	}

	async loadServerConfig() {
		await core.progress_loading_screen('Fetching CDN configuration');

		const serverConfigs = await this.getConfig(this.build.Product, constants.PATCH.SERVER_CONFIG);
		log.write('%o', serverConfigs);

		this.serverConfig = serverConfigs.find(e => e.Name === this.region);
		if (!this.serverConfig)
			throw new Error('CDN config does not contain entry for region ' + this.region);
	}

	async parseArchiveIndex(key) {
		const fileName = key + '.index';

		let data = await this.cache.getFile(fileName, constants.CACHE.DIR_INDEXES);
		if (data === null) {
			const cdnKey = this.formatCDNKey(key) + '.index';
			data = await this.getDataFile(cdnKey);
			this.cache.storeFile(fileName, data, constants.CACHE.DIR_INDEXES);
		}

		data.seek(-12);
		const count = data.readInt32LE();

		if (count * 24 > data.byteLength)
			throw new Error('Unable to parse archive, unexpected size: ' + data.byteLength);

		data.seek(0);

		for (let i = 0; i < count; i++) {
			let hash = data.readHexString(16);

			if (hash === EMPTY_HASH)
				hash = data.readHexString(16);

			this.archives.set(hash, { key, size: data.readInt32BE(), offset: data.readInt32BE() });
		}
	}

	async getDataFile(file) {
		return await generics.downloadFile(this.host + 'data/' + file);
	}

	async getDataFilePartial(file, ofs, len) {
		return await generics.downloadFile(this.host + 'data/' + file, null, ofs, len);
	}

	async loadConfigs() {
		await core.progress_loading_screen('Fetching build configurations');

		const cdnHosts = await cdnResolver.getRankedHosts(this.region, this.serverConfig);

		this.cdnConfig = await this.getCDNConfig(this.build.CDNConfig, cdnHosts);
		this.buildConfig = await this.getCDNConfig(this.build.BuildConfig, cdnHosts);

		log.write('CDNConfig: %o', this.cdnConfig);
		log.write('BuildConfig: %o', this.buildConfig);
	}

	async resolveCDNHost() {
		await core.progress_loading_screen('Locating fastest CDN server');

		this.host = await cdnResolver.getBestHost(this.region, this.serverConfig);
	}

	formatCDNKey(key) {
		return key.substring(0, 2) + '/' + key.substring(2, 4) + '/' + key;
	}

	async _ensureFileInCache(encodingKey, fileDataID, suppressLog) {
		const cacheFileName = encodingKey + '.data';
		const cachedPath = this.cache.getFilePath(cacheFileName, constants.CACHE.DIR_DATA);

		const cached = await this.cache.getFile(cacheFileName, constants.CACHE.DIR_DATA);
		if (cached !== null)
			return cachedPath;

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

		await this.cache.storeFile(cacheFileName, blte, constants.CACHE.DIR_DATA);

		return cachedPath;
	}

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

	getBuildName() {
		return this.build.VersionsName;
	}

	getBuildKey() {
		return this.build.BuildConfig;
	}
}

export default CASCRemote;
