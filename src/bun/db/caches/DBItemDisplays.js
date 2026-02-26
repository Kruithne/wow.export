import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';
import * as DBModelFileData from './DBModelFileData.js';
import * as DBTextureFileData from './DBTextureFileData.js';

const item_displays = new Map();
let initialized = false;

const initialize_item_displays = async () => {
	if (initialized)
		return;

	await DBTextureFileData.ensureInitialized();

	log.write('Loading item textures...');

	for (const [item_display_info_id, row] of await db2.ItemDisplayInfo.getAllRows()) {
		const model_res_ids = row.ModelResourcesID.filter(e => e > 0);
		if (model_res_ids.length == 0)
			continue;

		const mat_res_ids = row.ModelMaterialResourcesID.filter(e => e > 0);
		if (mat_res_ids.length == 0)
			continue;

		const model_file_data_ids = DBModelFileData.getModelFileDataID(model_res_ids[0]);
		const texture_file_data_ids = DBTextureFileData.getTextureFDIDsByMatID(mat_res_ids[0]);

		if (model_file_data_ids !== undefined && texture_file_data_ids !== undefined) {
			for (const model_file_data_id of model_file_data_ids) {
				const display = { ID: item_display_info_id, textures: texture_file_data_ids };

				if (item_displays.has(model_file_data_id))
					item_displays.get(model_file_data_id).push(display);
				else
					item_displays.set(model_file_data_id, [display]);
			}
		}
	}

	log.write('Loaded textures for %d items', item_displays.size);
	initialized = true;
};

const get_item_displays_by_file_data_id = (file_data_id) => {
	return item_displays.get(file_data_id);
};

export {
	initialize_item_displays as initializeItemDisplays,
	get_item_displays_by_file_data_id as getItemDisplaysByFileDataID
};
