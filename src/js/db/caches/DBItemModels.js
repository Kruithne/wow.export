/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBModelFileData = require('./DBModelFileData');
const DBTextureFileData = require('./DBTextureFileData');
const DBComponentModelFileData = require('./DBComponentModelFileData');

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> { modelOptions: [[fdid, ...], ...], textures: [fdid, ...], geosetGroup: [...], attachmentGeosetGroup: [...] }
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
		await DBComponentModelFileData.initialize();

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

			// store ALL file data IDs per model resource (filter by race/gender at query time)
			const model_options = [];
			for (const model_res_id of model_res_ids) {
				const file_data_ids = DBModelFileData.getModelFileDataID(model_res_id);
				if (file_data_ids && file_data_ids.length > 0)
					model_options.push(file_data_ids);
				else
					model_options.push([]);
			}

			if (model_options.every(arr => arr.length === 0))
				continue;

			// get texture file data IDs from material resources
			const mat_res_ids = row.ModelMaterialResourcesID.filter(e => e > 0);
			const texture_file_data_ids = [];
			for (const mat_res_id of mat_res_ids) {
				const tex_fdids = DBTextureFileData.getTextureFDIDsByMatID(mat_res_id);
				if (tex_fdids && tex_fdids.length > 0)
					texture_file_data_ids.push(tex_fdids[0]);
			}

			// geoset groups for character model and attachment/collection models
			const geoset_group = row.GeosetGroup || [];
			const attachment_geoset_group = row.AttachmentGeosetGroup || [];

			display_to_data.set(display_id, {
				modelOptions: model_options,
				textures: texture_file_data_ids,
				geosetGroup: geoset_group,
				attachmentGeosetGroup: attachment_geoset_group
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
 * Get model file data IDs for an item (first option per model resource).
 * @param {number} item_id
 * @returns {Array<number>|null}
 */
const get_item_models = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const data = display_to_data.get(display_id);
	if (!data?.modelOptions)
		return null;

	// return first option for each model resource
	const models = data.modelOptions.map(opts => opts[0]).filter(Boolean);
	return models.length > 0 ? models : null;
};

/**
 * Get display data for an item (models and textures).
 * Filters models by race/gender if provided.
 * @param {number} item_id
 * @param {number} [race_id] - character race ID for filtering
 * @param {number} [gender_index] - 0=male, 1=female for filtering
 * @returns {{ID: number, textures: number[], models: number[], geosetGroup: number[], attachmentGeosetGroup: number[]}|null}
 */
const get_item_display = (item_id, race_id, gender_index) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const data = display_to_data.get(display_id);
	if (!data)
		return null;

	// filter models by race/gender
	const models = [];

	// check if this is a shoulder-type item (2 model options with identical content)
	// shoulders share the same model pool but use PositionIndex to distinguish left/right
	const is_shoulder_style = data.modelOptions.length === 2 &&
		data.modelOptions[0].length > 0 &&
		data.modelOptions[1].length > 0 &&
		data.modelOptions[0].length === data.modelOptions[1].length &&
		data.modelOptions[0].every((v, i) => v === data.modelOptions[1][i]);

	if (is_shoulder_style && race_id !== undefined && gender_index !== undefined) {
		// for shoulders, select two models with different PositionIndex values
		const options = data.modelOptions[0];
		const candidates = DBComponentModelFileData.getModelsForRaceGenderByPosition(options, race_id, gender_index);

		if (candidates.left)
			models.push(candidates.left);

		if (candidates.right)
			models.push(candidates.right);
	} else {
		// standard logic for non-shoulder items
		for (const options of data.modelOptions) {
			if (options.length === 0)
				continue;

			if (race_id !== undefined && gender_index !== undefined) {
				const best = DBComponentModelFileData.getModelForRaceGender(options, race_id, gender_index);
				if (best)
					models.push(best);
			} else {
				models.push(options[0]);
			}
		}
	}

	return {
		ID: display_id,
		models: models,
		textures: data.textures,
		geosetGroup: data.geosetGroup,
		attachmentGeosetGroup: data.attachmentGeosetGroup
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

/**
 * Get display data directly by ItemDisplayInfoID (skips item->display lookup).
 * @param {number} display_id
 * @param {number} [race_id]
 * @param {number} [gender_index]
 * @returns {{ID: number, textures: number[], models: number[], geosetGroup: number[], attachmentGeosetGroup: number[]}|null}
 */
const get_display_data = (display_id, race_id, gender_index) => {
	const data = display_to_data.get(display_id);
	if (!data)
		return null;

	const models = [];

	const is_shoulder_style = data.modelOptions.length === 2 &&
		data.modelOptions[0].length > 0 &&
		data.modelOptions[1].length > 0 &&
		data.modelOptions[0].length === data.modelOptions[1].length &&
		data.modelOptions[0].every((v, i) => v === data.modelOptions[1][i]);

	if (is_shoulder_style && race_id !== undefined && gender_index !== undefined) {
		const options = data.modelOptions[0];
		const candidates = DBComponentModelFileData.getModelsForRaceGenderByPosition(options, race_id, gender_index);

		if (candidates.left)
			models.push(candidates.left);

		if (candidates.right)
			models.push(candidates.right);
	} else {
		for (const options of data.modelOptions) {
			if (options.length === 0)
				continue;

			if (race_id !== undefined && gender_index !== undefined) {
				const best = DBComponentModelFileData.getModelForRaceGender(options, race_id, gender_index);
				if (best)
					models.push(best);
			} else {
				models.push(options[0]);
			}
		}
	}

	return {
		ID: display_id,
		models,
		textures: data.textures,
		geosetGroup: data.geosetGroup,
		attachmentGeosetGroup: data.attachmentGeosetGroup
	};
};

module.exports = {
	initialize,
	ensureInitialized: ensure_initialized,
	getItemModels: get_item_models,
	getItemDisplay: get_item_display,
	getDisplayId: get_display_id,
	getDisplayData: get_display_data
};
