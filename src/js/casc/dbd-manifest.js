/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const generics = require('../generics');

let is_preloaded = false;
let preload_promise = null;
let table_to_id = new Map();
let id_to_table = new Map();

/**
 * preload the dbd manifest from configured urls
 */
function preload() {
	if (preload_promise !== null)
		return;

	preload_promise = (async () => {
		try {
			const dbd_filename_url = core.view.config.dbdFilenameURL;
			const dbd_filename_fallback_url = core.view.config.dbdFilenameFallbackURL;

			const raw = await generics.downloadFile([dbd_filename_url, dbd_filename_fallback_url]);
			const manifest_data = raw.readJSON();

			for (const entry of manifest_data) {
				if (entry.tableName && entry.db2FileDataID) {
					table_to_id.set(entry.tableName, entry.db2FileDataID);
					id_to_table.set(entry.db2FileDataID, entry.tableName);
				}
			}

			log.write('preloaded dbd manifest with %d entries', table_to_id.size);
			is_preloaded = true;
		} catch (e) {
			log.write('failed to preload dbd manifest: %s', e.message);
			is_preloaded = true;
		}
	})();
}

/**
 * prepare the manifest for use, awaiting preload if necessary
 * @returns {Promise<boolean>}
 */
async function prepareManifest() {
	if (is_preloaded)
		return true;

	await preload_promise;
	return true;
}

/**
 * get table name by filedataid
 * @param {number} id
 * @returns {string|undefined}
 */
function getByID(id) {
	return id_to_table.get(id);
}

/**
 * get filedataid by table name
 * @param {string} table_name
 * @returns {number|undefined}
 */
function getByTableName(table_name) {
	return table_to_id.get(table_name);
}

module.exports = { preload, prepareManifest, getByID, getByTableName };
