import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';
import * as DBModelFileData from './DBModelFileData.js';
import * as DBTextureFileData from './DBTextureFileData.js';
import * as DBComponentModelFileData from './DBComponentModelFileData.js';

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> { modelOptions, textures, geosetGroup, attachmentGeosetGroup }
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

		const appearance_map = new Map();
		for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
			appearance_map.set(row.ItemID, row.ItemAppearanceID);

		const appearance_to_display = new Map();
		for (const [id, row] of await db2.ItemAppearance.getAllRows())
			appearance_to_display.set(id, row.ItemDisplayInfoID);

		for (const [item_id, appearance_id] of appearance_map) {
			const display_id = appearance_to_display.get(appearance_id);
			if (display_id !== undefined && display_id !== 0)
				item_to_display_id.set(item_id, display_id);
		}

		for (const [display_id, row] of await db2.ItemDisplayInfo.getAllRows()) {
			const model_res_ids = row.ModelResourcesID.filter(e => e > 0);
			if (model_res_ids.length === 0)
				continue;

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

			const mat_res_ids = row.ModelMaterialResourcesID.filter(e => e > 0);
			const texture_file_data_ids = [];
			for (const mat_res_id of mat_res_ids) {
				const tex_fdids = DBTextureFileData.getTextureFDIDsByMatID(mat_res_id);
				if (tex_fdids && tex_fdids.length > 0)
					texture_file_data_ids.push(tex_fdids[0]);
			}

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

const get_item_models = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const data = display_to_data.get(display_id);
	if (!data?.modelOptions)
		return null;

	const models = data.modelOptions.map(opts => opts[0]).filter(Boolean);
	return models.length > 0 ? models : null;
};

const get_item_display = (item_id, race_id, gender_index) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

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
		models: models,
		textures: data.textures,
		geosetGroup: data.geosetGroup,
		attachmentGeosetGroup: data.attachmentGeosetGroup
	};
};

const get_display_id = (item_id) => {
	return item_to_display_id.get(item_id);
};

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

export {
	initialize,
	ensure_initialized as ensureInitialized,
	get_item_models as getItemModels,
	get_item_display as getItemDisplay,
	get_display_id as getDisplayId,
	get_display_data as getDisplayData
};
