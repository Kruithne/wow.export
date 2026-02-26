import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

const decor_items = new Map();
let is_initialized = false;

const initialize_decor_data = async () => {
	if (is_initialized)
		return;

	log.write('Loading house decor data...');

	for (const [id, row] of await db2.HouseDecor.getAllRows()) {
		const model_file_id = row.ModelFileDataID;
		if (model_file_id === 0)
			continue;

		decor_items.set(id, {
			id,
			name: row.Name_lang || `Decor ${id}`,
			modelFileDataID: model_file_id,
			thumbnailFileDataID: row.ThumbnailFileDataID || 0,
			itemID: row.ItemID || 0,
			gameObjectID: row.GameObjectID || 0,
			type: row.Type || 0,
			modelType: row.ModelType || 0
		});
	}

	log.write('Loaded %d house decor items', decor_items.size);
	is_initialized = true;
};

const get_all_decor_items = () => {
	return decor_items;
};

const get_decor_item_by_id = (id) => {
	return decor_items.get(id);
};

const get_decor_item_by_model_file_data_id = (file_data_id) => {
	for (const item of decor_items.values()) {
		if (item.modelFileDataID === file_data_id)
			return item;
	}

	return undefined;
};

export {
	initialize_decor_data as initializeDecorData,
	get_all_decor_items as getAllDecorItems,
	get_decor_item_by_id as getDecorItemByID,
	get_decor_item_by_model_file_data_id as getDecorItemByModelFileDataID
};
