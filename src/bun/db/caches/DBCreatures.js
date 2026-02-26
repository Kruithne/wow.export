import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

const creature_displays = new Map();
const creature_display_info_map = new Map();
const display_id_to_file_data_id = new Map();
let is_initialized = false;

const initialize_creature_data = async () => {
	if (is_initialized)
		return;

	log.write('Loading creature textures...');

	const creature_geoset_map = new Map();
	const creature_display_info_geoset_data = db2.CreatureDisplayInfoGeosetData;

	// CreatureDisplayInfoID => array of geosets to enable
	for (const geoset_row of (await creature_display_info_geoset_data.getAllRows()).values()) {
		if (!creature_geoset_map.has(geoset_row.CreatureDisplayInfoID))
			creature_geoset_map.set(geoset_row.CreatureDisplayInfoID, new Array());

		creature_geoset_map.get(geoset_row.CreatureDisplayInfoID).push((geoset_row.GeosetIndex + 1) * 100 + geoset_row.GeosetValue);
	}

	const model_id_to_display_info_map = new Map();

	for (const [display_id, display_row] of await db2.CreatureDisplayInfo.getAllRows()) {
		creature_display_info_map.set(display_id, { ID: display_id, modelID: display_row.ModelID, extendedDisplayInfoID: display_row.ExtendedDisplayInfoID, textures: display_row.TextureVariationFileDataID.filter(e => e > 0) });

		if (model_id_to_display_info_map.has(display_row.ModelID))
			model_id_to_display_info_map.get(display_row.ModelID).push(display_id);
		else
			model_id_to_display_info_map.set(display_row.ModelID, [display_id]);
	}

	for (const [model_id, model_row] of await db2.CreatureModelData.getAllRows()) {
		if (model_id_to_display_info_map.has(model_id)) {
			const file_data_id = model_row.FileDataID;
			const display_ids = model_id_to_display_info_map.get(model_id);
			const model_id_has_extra_geosets = model_row.CreatureGeosetDataID > 0;

			for (const display_id of display_ids) {
				display_id_to_file_data_id.set(display_id, file_data_id);

				const display = creature_display_info_map.get(display_id);

				if (model_id_has_extra_geosets) {
					display.extraGeosets = Array();
					if (creature_geoset_map.has(display_id))
						display.extraGeosets = creature_geoset_map.get(display_id);
				}

				if (creature_displays.has(file_data_id))
					creature_displays.get(file_data_id).push(display);
				else
					creature_displays.set(file_data_id, [display]);
			}
		}
	}

	log.write('Loaded textures for %d creatures', creature_displays.size);
	is_initialized = true;
};

const get_creature_displays_by_file_data_id = (file_data_id) => {
	return creature_displays.get(file_data_id);
};

const get_file_data_id_by_display_id = (display_id) => {
	return display_id_to_file_data_id.get(display_id);
};

const get_display_info = (display_id) => {
	return creature_display_info_map.get(display_id);
};

export {
	initialize_creature_data as initializeCreatureData,
	get_creature_displays_by_file_data_id as getCreatureDisplaysByFileDataID,
	get_file_data_id_by_display_id as getFileDataIDByDisplayID,
	get_display_info as getDisplayInfo
};
