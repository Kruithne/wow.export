import util from 'node:util';
import * as constants from '../lib/constants.js';
import * as generics from '../lib/generics.js';
import * as log from '../lib/log.js';
import * as core from '../lib/core.js';
import VersionConfig from './version-config.js';

class CDNResolver {
	constructor() {
		this.resolutionCache = new Map();
		this.failedHosts = new Set();
	}

	startPreResolution(region, product = 'wow') {
		log.write('Starting CDN pre-resolution for region: %s', region);
		this._resolveRegionProduct(region, product);
	}

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

	markHostFailed(host) {
		log.write('Marking CDN host as failed: %s', host);
		this.failedHosts.add(host);
	}

	_getCacheKey(region, hosts) {
		const fallback = core.get_config('cdnFallbackHosts') ?? '';
		return region + '|' + hosts + '|' + fallback;
	}

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

			await this.getBestHost(region, serverConfig);
		} catch (error) {
			log.write('Failed to pre-resolve CDN hosts for region %s: %s', region, error.message);
		}
	}

	async _resolveHosts(region, serverConfig) {
		log.write('Resolving best host for %s: %s', region, serverConfig.Hosts);

		const hosts = serverConfig.Hosts.split(' ').map(e => 'https://' + e + '/');

		const fallback_raw = core.get_config('cdnFallbackHosts') ?? '';
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

export default new CDNResolver();
