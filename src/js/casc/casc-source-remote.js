const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');
const log = require('../log');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');
const CDNConfig = require('./cdn-config');

class CASCRemote extends CASC {
	/**
	 * Create a new CASC source using a Blizzard CDN.
	 * @param {string} region Region tag (eu, us, etc).
	 */
	constructor(region) {
		super();

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
		const promises = Object.keys(constants.PRODUCTS).map(p => this.getVersionConfig(p));
		const results = await Promise.allSettled(promises);

		// Iterate through successful requests and extract product config for our region.
		for (const result of results)
			if (result.status === 'fulfilled')
				this.builds.push(result.value.find(e => e.Region === this.region));

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

		if (res.statusCode !== 200)
			throw new Error(util.format('HTTP %d from remote CASC endpoint: %s', res.statusCode, url));

		return VersionConfig(await generics.consumeUTF8Stream(res));
	}

	/**
	 * Download and parse a CDN config file.
	 * @param {string} key 
	 */
	async getCDNConfig(key) {
		const url = this.host + 'config/' + this.formatCDNKey(key);
		const res = await generics.get(url);

		if (res.statusCode !== 200)
			throw new Error(util.format('Unable to retrieve CDN config file %s (HTTP %d)', key, res.statusCode));

		return CDNConfig(await generics.consumeUTF8Stream(res));
	}

	/**
	 * Returns a list of available products on the remote CDN.
	 * Format example: "PTR: World of Warcraft 8.3.0.32272"
	 */
	getProductList() {
		const products = [];
		for (const entry of this.builds)
			products.push(util.format('%s %s', constants.PRODUCTS[entry.Product], entry.VersionsName));

		return products;
	}

	/**
	 * Load the CASC interface with the given build.
	 * @param {number} buildIndex
	 */
	async load(buildIndex) {
		this.build = this.builds[buildIndex];
		log.write('Loading remote CASC build: %o', this.build);

		this.progress = core.createProgress(6);
		await this.downloadServerConfig();
		await this.resolveCDNHost();
		await this.downloadCDNConfigs();
		await this.downloadArchives();
		await this.downloadEncoding();
		this.progress.finish();

		// ToDo: Root file.
	}

	/**
	 * Download and parse the encoding file.
	 */
	async downloadEncoding() {
		// Download encoding file.
		log.timeLog();
		const encKeys = this.buildConfig.encoding.split(' '); // MD5 + Key
		const cdnKey = this.formatCDNKey(encKeys[1]);

		await this.progress.updateWithText(5, 'Fetching encoding table');
		const encRaw = await this.getDataFile(cdnKey, async (bytes, total) => await this.progress.update(5, bytes / total));
		log.timeEnd('Downloaded encoding table');

		// Parse encoding file.
		log.timeLog();
		await this.progress.updateWithText(6, 'Parsing encoding table');
		await this.parseEncodingFile(encRaw, encKeys[1]);
		log.timeEnd('Parsed encoding table');
	}

	/**
	 * Download and parse archive files.
	 */
	async downloadArchives() {
		// Download archive indexes.
		let archiveProgress = 0;
		const archiveKeys = this.cdnConfig.archives.split(' ');
		const archiveCount = archiveKeys.length;

		log.timeLog();

		await this.progress.updateWithText(4, 'Fetching archives');
		await generics.queue(archiveKeys, async (key) => {
			this.archives.set(key, await this.getIndexFile(key));

			archiveProgress++;
			await this.progress.update(4, archiveProgress / archiveCount);
		}, 50);

		log.timeEnd('Downloaded %d archives', archiveCount);
	}

	/**
	 * Download the CDN configuration and store the entry for our
	 * selected region.
	 */
	async downloadServerConfig() {
		// Download CDN server list.
		await this.progress.updateWithText(1, 'Fetching CDN configuration');
		const serverConfigs = await this.getConfig(this.build.Product, constants.PATCH.SERVER_CONFIG);
		log.write('%o', serverConfigs);

		// Locate the CDN entry for our selected region.
		this.serverConfig = serverConfigs.find(e => e.Name === this.region);
		if (!this.serverConfig)
			throw new Error('CDN config does not contain entry for region ' + this.region);
	}

	/**
	 * Download and parse the contents of an archive index.
	 * @param {string} key 
	 */
	async getIndexFile(key) {
		return this.parseIndexFile(await this.getDataFile(this.formatCDNKey(key) + '.index'));
	}

	/**
	 * Download a data file from the CDN.
	 * @param {string} file 
	 * @param {function} reporter
	 * @returns {BufferWrapper}
	 */
	async getDataFile(file, reporter) {
		const url = this.host + 'data/' + file;
		const res = await generics.get(url);

		if (res.statusCode !== 200)
			throw new Error(util.format('Unable to download file %s: HTTP %d', file, res.statusCode));

		const contentLength = Number(res.headers['content-length']);
		if (isNaN(contentLength))
			throw new Error('Response is missing Content-Length header: ' + file);

		return await generics.consumeStream(res, contentLength, reporter);
	}

	/**
	 * Download the CDNConfig and BuildConfig.
	 */
	async downloadCDNConfigs() {
		// Download CDNConfig and BuildConfig.
		await this.progress.updateWithText(3, 'Fetching build configurations');
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
		await this.progress.updateWithText(2, 'Locating fastest CDN server');
		log.write('Resolving best host: %s', this.serverConfig.Hosts);

		let bestHost = null;
		const hosts = this.serverConfig.Hosts.split(' ').map(e => 'http://' + e + '/');
		const hostPings = [];

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
	 * @param {string} key 
	 */
	formatCDNKey(key) {
		return key.substring(0, 2) + '/' + key.substring(2, 4) + '/' + key;
	}
}

module.exports = CASCRemote;