/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBModelFileData = require('./DBModelFileData');

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> array of model file data IDs
const display_to_models = new Map();

let is_initialized = false;
let init_promise = null;

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading item models...');

		await DBModelFileData.initializeModelFileData();

		// build item -> appearance -> display chain
		const appearance_map = new Map();
		for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
			appearance_map.set(row.ItemID, row.ItemAppearanceID);

		const appearance_to_display = new Map();
		for (const [id, row] of await db2.ItemAppearance.getAllRows())
			appearance_to_display.set(id, row.ItemDisplayInfoID);

		// map item id to display id
		for (const [item_id, appearance_id] of appearance_map) {
			const display_id = appearance_to_display.get(appearance_id);
			if (display_id !== undefined && display_id !== 0)
				item_to_display_id.set(item_id, display_id);
		}

		// load model file data IDs from ItemDisplayInfo
		for (const [display_id, row] of await db2.ItemDisplayInfo.getAllRows()) {
			const model_res_ids = row.ModelResourcesID.filter(e => e > 0);
			if (model_res_ids.length === 0)
				continue;

			const model_file_data_ids = [];
			for (const model_res_id of model_res_ids) {
				const file_data_ids = DBModelFileData.getModelFileDataID(model_res_id);
				if (file_data_ids)
					model_file_data_ids.push(...file_data_ids);
			}

			if (model_file_data_ids.length > 0)
				display_to_models.set(display_id, model_file_data_ids);
		}

		log.write('Loaded models for %d item displays', display_to_models.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize();
};

/**
 * Get model file data IDs for an item.
 * @param {number} item_id
 * @returns {Array<number>|null}
 */
const get_item_models = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const models = display_to_models.get(display_id);
	return models && models.length > 0 ? models : null;
};

/**
 * Get ItemDisplayInfoID for an item.
 * @param {number} item_id
 * @returns {number|undefined}
 */
const get_display_id = (item_id) => {
	return item_to_display_id.get(item_id);
};

module.exports = {
	initialize,
	ensureInitialized: ensure_initialized,
	getItemModels: get_item_models,
	getDisplayId: get_display_id
};
