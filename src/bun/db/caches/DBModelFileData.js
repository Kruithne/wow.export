import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

const model_res_id_to_file_data_id = new Map();
const file_data_ids = new Set();
let initialized = false;

const initializeModelFileData = async () => {
	if (initialized)
		return;

	log.write('Loading model mapping...');

	for (const [model_file_data_id, model_file_data_row] of await db2.ModelFileData.getAllRows()) {
		file_data_ids.add(model_file_data_id);

		if (model_res_id_to_file_data_id.has(model_file_data_row.ModelResourcesID))
			model_res_id_to_file_data_id.get(model_file_data_row.ModelResourcesID).push(model_file_data_id);
		else
			model_res_id_to_file_data_id.set(model_file_data_row.ModelResourcesID, [model_file_data_id]);
	}

	log.write('Loaded model mapping for %d models', model_res_id_to_file_data_id.size);
	initialized = true;
};

const getModelFileDataID = (model_res_id) => {
	return model_res_id_to_file_data_id.get(model_res_id);
};

const getFileDataIDs = () => {
	return file_data_ids;
};

export {
	initializeModelFileData,
	getModelFileDataID,
	getFileDataIDs
};
