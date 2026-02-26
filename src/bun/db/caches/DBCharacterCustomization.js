import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';
import * as DBCreatures from './DBCreatures.js';

const tfd_map = new Map();
const choice_to_geoset = new Map();
const choice_to_chr_cust_material_id = new Map();
const choice_to_skinned_model = new Map();
const unsupported_choices = new Array();

const options_by_chr_model = new Map();
const option_to_choices = new Map();
const default_options = new Array();

const chr_model_id_to_file_data_id = new Map();
const chr_model_id_to_texture_layout_id = new Map();

const chr_race_map = new Map();
const chr_race_x_chr_model_map = new Map();

const chr_model_material_map = new Map();
const char_component_texture_section_map = new Map();
const chr_model_texture_layer_map = new Map();

const geoset_map = new Map();
const chr_cust_mat_map = new Map();
const chr_cust_skinned_model_map = new Map();

let is_initialized = false;
let init_promise = null;

const ensureInitialized = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = _initialize();
	await init_promise;
};

const _initialize = async () => {
	log.write('Loading character customization data...');

	for (const tfd_row of (await db2.TextureFileData.getAllRows()).values()) {
		if (tfd_row.UsageType != 0)
			continue;
		tfd_map.set(tfd_row.MaterialResourcesID, tfd_row.FileDataID);
	}

	await DBCreatures.initializeCreatureData();

	for (const chr_customization_element_row of (await db2.ChrCustomizationElement.getAllRows()).values()) {
		if (chr_customization_element_row.ChrCustomizationGeosetID != 0)
			choice_to_geoset.set(chr_customization_element_row.ChrCustomizationChoiceID, chr_customization_element_row.ChrCustomizationGeosetID);

		if (chr_customization_element_row.ChrCustomizationSkinnedModelID != 0) {
			choice_to_skinned_model.set(chr_customization_element_row.ChrCustomizationChoiceID, chr_customization_element_row.ChrCustomizationSkinnedModelID);
			unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);
		}

		if (chr_customization_element_row.ChrCustomizationBoneSetID != 0)
			unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

		if (chr_customization_element_row.ChrCustomizationCondModelID != 0)
			unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

		if (chr_customization_element_row.ChrCustomizationDisplayInfoID != 0)
			unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

		if (chr_customization_element_row.ChrCustomizationMaterialID != 0) {
			if (choice_to_chr_cust_material_id.has(chr_customization_element_row.ChrCustomizationChoiceID))
				choice_to_chr_cust_material_id.get(chr_customization_element_row.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chr_customization_element_row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chr_customization_element_row.RelatedChrCustomizationChoiceID });
			else
				choice_to_chr_cust_material_id.set(chr_customization_element_row.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chr_customization_element_row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chr_customization_element_row.RelatedChrCustomizationChoiceID }]);

			const mat_row = await db2.ChrCustomizationMaterial.getRow(chr_customization_element_row.ChrCustomizationMaterialID);
			if (mat_row !== null)
				chr_cust_mat_map.set(mat_row.ID, { ChrModelTextureTargetID: mat_row.ChrModelTextureTargetID, FileDataID: tfd_map.get(mat_row.MaterialResourcesID) });
		}
	}

	const options_by_model = new Map();
	const choices_by_option = new Map();

	for (const [chr_customization_option_id, chr_customization_option_row] of await db2.ChrCustomizationOption.getAllRows()) {
		const model_id = chr_customization_option_row.ChrModelID;
		if (!options_by_model.has(model_id))
			options_by_model.set(model_id, []);

		options_by_model.get(model_id).push([chr_customization_option_id, chr_customization_option_row]);
	}

	for (const [chr_customization_choice_id, chr_customization_choice_row] of await db2.ChrCustomizationChoice.getAllRows()) {
		const option_id = chr_customization_choice_row.ChrCustomizationOptionID;
		if (!choices_by_option.has(option_id))
			choices_by_option.set(option_id, []);

		choices_by_option.get(option_id).push([chr_customization_choice_id, chr_customization_choice_row]);
	}

	for (const [chr_model_id, chr_model_row] of await db2.ChrModel.getAllRows()) {
		const file_data_id = DBCreatures.getFileDataIDByDisplayID(chr_model_row.DisplayID);

		chr_model_id_to_file_data_id.set(chr_model_id, file_data_id);
		chr_model_id_to_texture_layout_id.set(chr_model_id, chr_model_row.CharComponentTextureLayoutID);

		const model_options = options_by_model.get(chr_model_id);
		if (!model_options)
			continue;

		for (const [chr_customization_option_id, chr_customization_option_row] of model_options) {
			const choice_list = [];

			if (!options_by_chr_model.has(chr_customization_option_row.ChrModelID))
				options_by_chr_model.set(chr_customization_option_row.ChrModelID, []);

			let option_name = '';
			if (chr_customization_option_row.Name_lang != '')
				option_name = chr_customization_option_row.Name_lang;
			else
				option_name = 'Option ' + chr_customization_option_row.OrderIndex;

			options_by_chr_model.get(chr_customization_option_row.ChrModelID).push({ id: chr_customization_option_id, label: option_name });

			const option_choices = choices_by_option.get(chr_customization_option_id);
			if (option_choices) {
				for (const [chr_customization_choice_id, chr_customization_choice_row] of option_choices) {
					let name = '';
					if (chr_customization_choice_row.Name_lang != '')
						name = chr_customization_choice_row.Name_lang;
					else
						name = 'Choice ' + chr_customization_choice_row.OrderIndex;

					const [swatch_color_0, swatch_color_1] = chr_customization_choice_row.SwatchColor || [0, 0];
					choice_list.push({
						id: chr_customization_choice_id,
						label: name,
						swatch_color_0,
						swatch_color_1
					});
				}
			}

			const is_color_swatch = choice_list.some(c => c.swatch_color_0 !== 0 || c.swatch_color_1 !== 0);
			option_to_choices.set(chr_customization_option_id, choice_list);
			if (is_color_swatch)
				options_by_chr_model.get(chr_customization_option_row.ChrModelID)[options_by_chr_model.get(chr_customization_option_row.ChrModelID).length - 1].is_color_swatch = true;

			if (!(chr_customization_option_row.Flags & 0x20))
				default_options.push(chr_customization_option_id);
		}
	}

	for (const [chr_race_id, chr_race_row] of await db2.ChrRaces.getAllRows()) {
		const flags = chr_race_row.Flags;
		chr_race_map.set(chr_race_id, { id: chr_race_id, name: chr_race_row.Name_lang, isNPCRace: ((flags & 1) == 1 && chr_race_id != 23 && chr_race_id != 75) });
	}

	for (const chr_race_x_chr_model_row of (await db2.ChrRaceXChrModel.getAllRows()).values()) {
		if (!chr_race_x_chr_model_map.has(chr_race_x_chr_model_row.ChrRacesID))
			chr_race_x_chr_model_map.set(chr_race_x_chr_model_row.ChrRacesID, new Map());

		chr_race_x_chr_model_map.get(chr_race_x_chr_model_row.ChrRacesID).set(chr_race_x_chr_model_row.Sex, chr_race_x_chr_model_row.ChrModelID);
	}

	for (const chr_model_material_row of (await db2.ChrModelMaterial.getAllRows()).values())
		chr_model_material_map.set(chr_model_material_row.CharComponentTextureLayoutsID + '-' + chr_model_material_row.TextureType, chr_model_material_row);

	for (const char_component_texture_section_row of (await db2.CharComponentTextureSections.getAllRows()).values()) {
		if (!char_component_texture_section_map.has(char_component_texture_section_row.CharComponentTextureLayoutID))
			char_component_texture_section_map.set(char_component_texture_section_row.CharComponentTextureLayoutID, []);

		char_component_texture_section_map.get(char_component_texture_section_row.CharComponentTextureLayoutID).push(char_component_texture_section_row);
	}

	for (const chr_model_texture_layer_row of (await db2.ChrModelTextureLayer.getAllRows()).values())
		chr_model_texture_layer_map.set(chr_model_texture_layer_row.CharComponentTextureLayoutsID + '-' + chr_model_texture_layer_row.ChrModelTextureTargetID[0], chr_model_texture_layer_row);

	for (const [chr_customization_geoset_id, chr_customization_geoset_row] of await db2.ChrCustomizationGeoset.getAllRows()) {
		const geoset = chr_customization_geoset_row.GeosetType.toString().padStart(2, '0') + chr_customization_geoset_row.GeosetID.toString().padStart(2, '0');
		geoset_map.set(chr_customization_geoset_id, Number(geoset));
	}

	for (const [chr_customization_skinned_model_id, chr_customization_skinned_model_row] of await db2.ChrCustomizationSkinnedModel.getAllRows())
		chr_cust_skinned_model_map.set(chr_customization_skinned_model_id, chr_customization_skinned_model_row);

	log.write('Character customization data loaded');
	is_initialized = true;
	init_promise = null;
};

const get_model_file_data_id = (model_id) => chr_model_id_to_file_data_id.get(model_id);
const get_texture_layout_id = (model_id) => chr_model_id_to_texture_layout_id.get(model_id);
const get_options_for_model = (model_id) => options_by_chr_model.get(model_id);
const get_choices_for_option = (option_id) => option_to_choices.get(option_id);
const get_default_options = () => default_options;
const get_option_to_choices_map = () => option_to_choices;

const get_chr_model_id = (race_id, sex) => {
	const models = chr_race_x_chr_model_map.get(race_id);
	if (!models)
		return undefined;

	return models.get(sex);
};

const get_race_models = (race_id) => chr_race_x_chr_model_map.get(race_id);
const get_chr_race_map = () => chr_race_map;
const get_chr_race_x_chr_model_map = () => chr_race_x_chr_model_map;

const get_choice_geoset_id = (choice_id) => {
	const chr_cust_geo_id = choice_to_geoset.get(choice_id);
	return geoset_map.get(chr_cust_geo_id);
};

const get_choice_geoset_raw = (choice_id) => choice_to_geoset.get(choice_id);
const get_geoset_value = (geoset_id) => geoset_map.get(geoset_id);

const get_choice_materials = (choice_id) => choice_to_chr_cust_material_id.get(choice_id);
const get_chr_cust_material = (mat_id) => chr_cust_mat_map.get(mat_id);

const get_model_texture_layer = (layout_id, target_id) => chr_model_texture_layer_map.get(layout_id + '-' + target_id);
const get_model_material = (layout_id, texture_type) => chr_model_material_map.get(layout_id + '-' + texture_type);
const get_texture_sections = (layout_id) => char_component_texture_section_map.get(layout_id);

const get_model_material_map = () => chr_model_material_map;
const get_model_texture_layer_map = () => chr_model_texture_layer_map;

const get_texture_file_data_id = (material_resources_id) => tfd_map.get(material_resources_id);

const get_choice_skinned_model = (choice_id) => choice_to_skinned_model.get(choice_id);
const get_skinned_model = (id) => chr_cust_skinned_model_map.get(id);

export {
	ensureInitialized,

	get_model_file_data_id,
	get_texture_layout_id,
	get_options_for_model,
	get_choices_for_option,
	get_default_options,
	get_option_to_choices_map,

	get_chr_model_id,
	get_race_models,
	get_chr_race_map,
	get_chr_race_x_chr_model_map,

	get_choice_geoset_id,
	get_choice_geoset_raw,
	get_geoset_value,
	get_choice_materials,
	get_chr_cust_material,

	get_model_texture_layer,
	get_model_material,
	get_texture_sections,
	get_model_material_map,
	get_model_texture_layer_map,

	get_texture_file_data_id,
	get_choice_skinned_model,
	get_skinned_model
};
