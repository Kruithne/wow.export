/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import { parse_xml } from './xml.js';
import { get_slot_id_for_wmv_slot } from './wow/EquipmentSlots.js';

const wmv_parse = (xml_str) => {
	const parsed = parse_xml(xml_str);

	if (!parsed.SavedCharacter)
		throw new Error('invalid .chr file: missing SavedCharacter root');

	const version = parsed.SavedCharacter['@_version'];

	if (version === '2.0')
		return wmv_parse_v2(parsed.SavedCharacter);
	else if (version === '1.0')
		return wmv_parse_v1(parsed.SavedCharacter);
	else
		throw new Error(`unsupported .chr version: ${version}`);
};

const wmv_parse_v2 = (data) => {
	const model_path = data.model?.file?.['@_name'];
	if (!model_path)
		throw new Error('invalid .chr file: missing model path');

	const { race, gender } = extract_race_gender_from_path(model_path);

	const customizations = [];
	const char_details = data.model?.CharDetails;

	if (char_details?.customization) {
		const cust_array = Array.isArray(char_details.customization)
			? char_details.customization
			: [char_details.customization];

		for (const cust of cust_array) {
			const option_id = parseInt(cust['@_id']);
			const choice_id = parseInt(cust['@_value']);

			if (!isNaN(option_id) && !isNaN(choice_id))
				customizations.push({ option_id, choice_id });
		}
	}

	// parse equipment
	const equipment = {};
	if (data.equipment?.item) {
		const items = Array.isArray(data.equipment.item)
			? data.equipment.item
			: [data.equipment.item];

		for (const item of items) {
			const wmv_slot = parseInt(item.slot?.['@_value']);
			const item_id = parseInt(item.id?.['@_value']);

			if (isNaN(wmv_slot) || isNaN(item_id) || item_id === 0)
				continue;

			const slot_id = get_slot_id_for_wmv_slot(wmv_slot);
			if (slot_id)
				equipment[slot_id] = item_id;
		}
	}

	return {
		race,
		gender,
		customizations,
		equipment,
		model_path
	};
};

const wmv_parse_v1 = (data) => {
	const model_path = data.model?.file?.['@_name'];
	if (!model_path)
		throw new Error('invalid .chr file: missing model path');

	const { race, gender } = extract_race_gender_from_path(model_path);

	const char_details = data.model?.CharDetails;
	const legacy_values = {
		skin_color: parseInt(char_details?.skinColor?.['@_value'] ?? '0'),
		face_type: parseInt(char_details?.faceType?.['@_value'] ?? '0'),
		hair_color: parseInt(char_details?.hairColor?.['@_value'] ?? '0'),
		hair_style: parseInt(char_details?.hairStyle?.['@_value'] ?? '0'),
		facial_hair: parseInt(char_details?.facialHair?.['@_value'] ?? '0')
	};

	// parse equipment (v1 also has equipment node)
	const equipment = {};
	if (data.equipment?.item) {
		const items = Array.isArray(data.equipment.item)
			? data.equipment.item
			: [data.equipment.item];

		for (const item of items) {
			const wmv_slot = parseInt(item.slot?.['@_value']);
			const item_id = parseInt(item.id?.['@_value']);

			if (isNaN(wmv_slot) || isNaN(item_id) || item_id === 0)
				continue;

			const slot_id = get_slot_id_for_wmv_slot(wmv_slot);
			if (slot_id)
				equipment[slot_id] = item_id;
		}
	}

	return {
		race,
		gender,
		legacy_values,
		equipment,
		model_path
	};
};

const extract_race_gender_from_path = (model_path) => {
	const race_map = {
		'human': 1,
		'orc': 2,
		'dwarf': 3,
		'nightelf': 4,
		'scourge': 5,
		'tauren': 6,
		'gnome': 7,
		'troll': 8,
		'goblin': 9,
		'bloodelf': 10,
		'draenei': 11,
		'worgen': 22,
		'pandaren': 24,
		'nightborne': 27,
		'highmountaintauren': 28,
		'voidelf': 29,
		'lightforgeddraenei': 30,
		'zandalaritroll': 31,
		'kultiran': 32,
		'darkirondwarf': 34,
		'vulpera': 35,
		'mechagnome': 37,
		'dracthyr': 52,
		'earthen': 84,

		// todo: 36, MagharOrc
	};

	const path_lower = model_path.toLowerCase().replace(/\\/g, '/');
	const parts = path_lower.split('/');

	let race = null;
	let gender = null;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];

		if (race_map[part])
			race = race_map[part];

		if (part === 'male' || part.includes('male') && !part.includes('female'))
			gender = 0;
		else if (part === 'female' || part.includes('female'))
			gender = 1;
	}

	if (race === null || gender === null)
		throw new Error(`unable to determine race/gender from model path: ${model_path}`);

	return { race, gender };
};

export { wmv_parse };
