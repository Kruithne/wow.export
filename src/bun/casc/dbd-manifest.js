import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import * as generics from '../lib/generics.js';

let is_preloaded = false;
let preload_promise = null;
let table_to_id = new Map();
let id_to_table = new Map();

function preload() {
	if (preload_promise !== null)
		return;

	preload_promise = (async () => {
		try {
			const dbd_filename_url = core.get_config('dbdFilenameURL');
			const dbd_filename_fallback_url = core.get_config('dbdFilenameFallbackURL');

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

async function prepareManifest() {
	if (is_preloaded)
		return true;

	await preload_promise;
	return true;
}

function getByID(id) {
	return id_to_table.get(id);
}

function getByTableName(table_name) {
	return table_to_id.get(table_name);
}

function getAllTableNames() {
	return Array.from(table_to_id.keys()).sort();
}

export { preload, prepareManifest, getByID, getByTableName, getAllTableNames };
