const path = require('path');
const fsp = require('fs').promises;
const log = require('../log');
const constants = require('../constants');
const CASC = require('./casc-source');
const VersionConfig = require('./version-config');

class CASCLocal extends CASC {
    /**
     * Create a new CASC source using a local installation.
     * @param {string} dir Installation path.
     */
    constructor(dir) {
        super();

        this.dir = dir;
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
     * Returns a list of available products in the installation.
     * Format example: "PTR: World of Warcraft 8.3.0.32272"
     */
    getProductList() {
        const products = [];
        for (const entry of this.builds)
            products.push(util.format('%s %s', constants.PRODUCTS[entry.Product], entry.Version));

        return products;
    }
}

module.exports = CASCLocal;