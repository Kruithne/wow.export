const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');

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
        const promises = Object.keys(constants.PRODUCTS).map(p => this.getRemoteVersionConfig(p));
        const results = await Promise.allSettled(promises);

        // Iterate through successful requests and extract product config for our region.
        for (const result of results)
            if (result.status === 'fulfilled')
                this.builds.push(result.value.find(e => e.Region === this.region));

        log.write('%o', this.builds);
    }

    /**
     * Obtain the remote version config for a specific product.
     * @param {string} product 
     */
    async getRemoteVersionConfig(product) {
        const url = this.host + product + constants.PATCH.VERSION_CONFIG;
        const res = await generics.get(url);

        if (res.statusCode !== 200)
            throw new Error('HTTP %d from remote CASC endpoint: %s', res.statusCode, url);

        const config = VersionConfig(await generics.consumeUTF8Stream(res));

        // Manually include product ID with the config for easier identification later.
        config.forEach(entry => entry.Product = product);
        
        return config;
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
}

module.exports = CASCRemote;