import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

const mat_res_id_to_file_data_id = new Map();
const file_data_ids = new Set();

const initializeTextureFileData = async () => {
	log.write('Loading texture mapping...');

	for (const [texture_file_data_id, texture_file_data_row] of await db2.TextureFileData.getAllRows()) {
		file_data_ids.add(texture_file_data_id);

		// TODO: remap to support other UsageTypes
		if (texture_file_data_row.UsageType !== 0)
			continue;

		if (mat_res_id_to_file_data_id.has(texture_file_data_row.MaterialResourcesID))
			mat_res_id_to_file_data_id.get(texture_file_data_row.MaterialResourcesID).push(texture_file_data_id);
		else
			mat_res_id_to_file_data_id.set(texture_file_data_row.MaterialResourcesID, [texture_file_data_id]);
	}

	log.write('Loaded texture mapping for %d materials', mat_res_id_to_file_data_id.size);
};

const getTextureFDIDsByMatID = (mat_res_id) => {
	return mat_res_id_to_file_data_id.get(mat_res_id);
};

const ensureInitialized = async () => {
	if (mat_res_id_to_file_data_id.size === 0)
		await initializeTextureFileData();
};

const getFileDataIDs = () => {
	return file_data_ids;
};

export {
	initializeTextureFileData,
	ensureInitialized,
	getTextureFDIDsByMatID,
	getFileDataIDs
};
