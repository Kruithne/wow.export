/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');
const core = require('../core');
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
		
		// Track hosts that have failed to respond properly (e.g., censored responses)
		this.failedHosts = new Set();
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

		const rankedHosts = await promise;
		this.resolutionCache.set(cacheKey, {
			promise: null,
			bestHost: rankedHosts[0],
			rankedHosts
		});

		return rankedHosts[0].host + serverConfig.Path + '/';
	}

	/**
	 * Get all available hosts for a region ranked by ping speed.
	 * Excludes hosts that have previously failed.
	 * @param {string} region Region tag
	 * @param {object} serverConfig Server configuration with Hosts and Path
	 * @returns {Promise<Array<string>>} Array of host URLs ranked by speed
	 */
	async getRankedHosts(region, serverConfig) {
		const cacheKey = this._getCacheKey(region, serverConfig.Hosts);
		const cached = this.resolutionCache.get(cacheKey);

		if (cached && cached.rankedHosts) {
			log.write('Using cached ranked CDN hosts for %s', region);
			return cached.rankedHosts.map(h => h.host + serverConfig.Path + '/');
		}

		if (cached && cached.promise) {
			log.write('Waiting for CDN resolution for %s', region);
			await cached.promise;
			const updated = this.resolutionCache.get(cacheKey);
			return updated.rankedHosts.map(h => h.host + serverConfig.Path + '/');
		}

		log.write('Resolving CDN hosts for %s: %s', region, serverConfig.Hosts);
		const promise = this._resolveHosts(region, serverConfig);

		this.resolutionCache.set(cacheKey, {
			promise,
			bestHost: null,
			rankedHosts: null
		});

		const rankedHosts = await promise;
		this.resolutionCache.set(cacheKey, {
			promise: null,
			bestHost: rankedHosts[0],
			rankedHosts
		});

		return rankedHosts.map(h => h.host + serverConfig.Path + '/');
	}

	/**
	 * Mark a host as failed (e.g., due to censorship or invalid responses).
	 * @param {string} host Host URL to mark as failed
	 */
	markHostFailed(host) {
		log.write('Marking CDN host as failed: %s', host);
		this.failedHosts.add(host);
	}

	/**
	 * Generate cache key from region and hosts.
	 * @param {string} region Region tag
	 * @param {string} hosts Space-separated hosts
	 * @returns {string} Cache key
	 */
	_getCacheKey(region, hosts) {
		const fallback = core.view?.config?.cdnFallbackHosts ?? '';
		return region + '|' + hosts + '|' + fallback;
	}

	/**
	 * Start resolution for a specific region/product combination for pre-caching.
	 * @param {string} region Region tag
	 * @param {string} product Product name
	 */
	async _resolveRegionProduct(region, product) {
		try {
			let host = util.format(constants.PATCH.HOST, region);
			if(region === 'cn')
				host = constants.PATCH.HOST_CHINA;

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
	 * Ping all hosts in server config and rank them by speed.
	 * Excludes hosts that have previously failed.
	 * @param {string} region Region tag
	 * @param {object} serverConfig Server configuration
	 * @returns {Promise<Array<object>>} Array of hosts sorted by ping (fastest first)
	 */
	async _resolveHosts(region, serverConfig) {
		log.write('Resolving best host for %s: %s', region, serverConfig.Hosts);

		const hosts = serverConfig.Hosts.split(' ').map(e => 'https://' + e + '/');

		const fallback_raw = core.view?.config?.cdnFallbackHosts ?? '';
		const fallback_hosts = fallback_raw.split(',')
			.map(h => h.trim())
			.filter(h => h.length > 0)
			.map(h => 'https://' + h + '/');

		for (const fh of fallback_hosts) {
			if (!hosts.includes(fh))
				hosts.push(fh);
		}

		const validHosts = [];
		const hostPings = [];

		for (const host of hosts) {
			if (this.failedHosts.has(host)) {
				log.write('Skipping previously failed host: %s', host);
				continue;
			}

			hostPings.push(generics.ping(host).then(ping => {
				log.write('Host %s resolved with %dms ping', host, ping);
				validHosts.push({ host, ping });
			}).catch(e => {
				log.write('Host %s failed to resolve a ping: %s', host, e);
			}));
		}

		await Promise.allSettled(hostPings);

		if (validHosts.length === 0)
			throw new Error('Unable to resolve any CDN hosts (all failed or blocked).');

		validHosts.sort((a, b) => a.ping - b.ping);

		log.write('%s resolved as the fastest host with a ping of %dms', validHosts[0].host, validHosts[0].ping);
		return validHosts;
	}
}

module.exports = new CDNResolver();