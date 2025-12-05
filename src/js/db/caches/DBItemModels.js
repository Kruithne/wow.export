/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBModelFileData = require('./DBModelFileData');
const DBTextureFileData = require('./DBTextureFileData');

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> { models: [fileDataID, ...], textures: [fileDataID, ...] }
const display_to_data = new Map();

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
		await DBTextureFileData.ensureInitialized();

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

		// load model and texture file data IDs from ItemDisplayInfo
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

			if (model_file_data_ids.length === 0)
				continue;

			// get texture file data IDs from material resources
			const mat_res_ids = row.ModelMaterialResourcesID.filter(e => e > 0);
			const texture_file_data_ids = [];
			for (const mat_res_id of mat_res_ids) {
				const tex_fdids = DBTextureFileData.getTextureFDIDsByMatID(mat_res_id);
				if (tex_fdids && tex_fdids.length > 0)
					texture_file_data_ids.push(tex_fdids[0]);
			}

			display_to_data.set(display_id, {
				models: model_file_data_ids,
				textures: texture_file_data_ids
			});
		}

		log.write('Loaded models for %d item displays', display_to_data.size);
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

	const data = display_to_data.get(display_id);
	return data?.models?.length > 0 ? data.models : null;
};

/**
 * Get display data for an item (models and textures).
 * Returns object compatible with M2RendererGL.applyReplaceableTextures()
 * @param {number} item_id
 * @returns {{ID: number, textures: number[], models: number[]}|null}
 */
const get_item_display = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const data = display_to_data.get(display_id);
	if (!data)
		return null;

	return {
		ID: display_id,
		models: data.models,
		textures: data.textures
	};
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
	getItemDisplay: get_item_display,
	getDisplayId: get_display_id
};
