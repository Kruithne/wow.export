/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');
const VersionConfig = require('./version-config');

/**
 * Manages CDN host resolution with intelligent pre-caching for performance.
 * Maintains a cache of regionTag + hostKey => bestHost mappings.
 */
class CDNResolver {
	constructor() {
		// Map of cacheKey -> { promise, bestHost }
		// cacheKey = region + '|' + hosts to handle different products with different hosts
		this.resolutionCache = new Map();
	}

	/**
	 * Start pre-resolution for a region if not already started.
	 * @param {string} region Region tag (eu, us, etc)
	 * @param {string} product Product to use for server config (defaults to 'wow')
	 */
	startPreResolution(region, product = 'wow') {
		log.write('Starting CDN pre-resolution for region: %s', region);
		this._resolveRegionProduct(region, product);
	}

	/**
	 * Get the best host for a region with specific server config.
	 * @param {string} region Region tag
	 * @param {object} serverConfig Server configuration with Hosts and Path
	 * @returns {Promise<string>} Best host URL
	 */
	async getBestHost(region, serverConfig) {
		const cacheKey = this._getCacheKey(region, serverConfig.Hosts);
		const cached = this.resolutionCache.get(cacheKey);
		
		if (cached && cached.bestHost) {
			log.write('Using cached CDN host for %s: %s', region, cached.bestHost.host);
			return cached.bestHost.host + serverConfig.Path + '/';
		}
		
		if (cached && cached.promise) {
			log.write('Waiting for CDN resolution for %s', region);
			const result = await cached.promise;
			return result.host + serverConfig.Path + '/';
		}
		
		log.write('Resolving CDN hosts for %s: %s', region, serverConfig.Hosts);
		const promise = this._resolveHosts(region, serverConfig);
		
		this.resolutionCache.set(cacheKey, {
			promise,
			bestHost: null
		});
		
		const bestHost = await promise;
		this.resolutionCache.set(cacheKey, {
			promise: null,
			bestHost
		});
		
		return bestHost.host + serverConfig.Path + '/';
	}

	/**
	 * Generate cache key from region and hosts.
	 * @param {string} region Region tag
	 * @param {string} hosts Space-separated hosts
	 * @returns {string} Cache key
	 */
	_getCacheKey(region, hosts) {
		return region + '|' + hosts;
	}

	/**
	 * Start resolution for a specific region/product combination for pre-caching.
	 * @param {string} region Region tag
	 * @param {string} product Product name
	 */
	async _resolveRegionProduct(region, product) {
		try {
			const host = util.format(constants.PATCH.HOST, region);
			const url = host + product + constants.PATCH.SERVER_CONFIG;
			const res = await generics.get(url);

			if (!res.ok)
				throw new Error(util.format('HTTP %d from server config endpoint: %s', res.status, url));

			const serverConfigs = VersionConfig(await res.text());
			const serverConfig = serverConfigs.find(e => e.Name === region);
			
			if (!serverConfig)
				throw new Error('CDN config does not contain entry for region ' + region);

			// Use getBestHost to resolve and cache
			await this.getBestHost(region, serverConfig);
		} catch (error) {
			log.write('Failed to pre-resolve CDN hosts for region %s: %s', region, error.message);
		}
	}

	/**
	 * Ping all hosts in server config and find the fastest one.
	 * @param {string} region Region tag  
	 * @param {object} serverConfig Server configuration
	 * @returns {Promise<object>} Best host with ping information
	 */
	async _resolveHosts(region, serverConfig) {
		log.write('Resolving best host for %s: %s', region, serverConfig.Hosts);

		let bestHost = null;
		const hosts = serverConfig.Hosts.split(' ').map(e => 'http://' + e + '/');
		const hostPings = [];

		for (const host of hosts) {
			hostPings.push(generics.ping(host).then(ping => {
				log.write('Host %s resolved with %dms ping', host, ping);
				if (bestHost === null || ping < bestHost.ping) {
					bestHost = { host, ping };
				}
			}).catch(e => {
				log.write('Host %s failed to resolve a ping: %s', host, e);
			}));
		}

		await Promise.allSettled(hostPings);

		if (bestHost === null)
			throw new Error('Unable to resolve a CDN host.');

		log.write('%s resolved as the fastest host with a ping of %dms', bestHost.host, bestHost.ping);
		return bestHost;
	}
}

module.exports = new CDNResolver();