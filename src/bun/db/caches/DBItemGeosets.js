import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> geoset data
const display_to_geosets = new Map();

// maps HelmetGeosetVisDataID -> Map<RaceID, number[]>
const helmet_hide_map = new Map();

let is_initialized = false;
let init_promise = null;

const CG = {
	SKIN_OR_HAIR: 0,
	FACE_1: 1,
	FACE_2: 2,
	FACE_3: 3,
	GLOVES: 4,
	BOOTS: 5,
	TAIL: 6,
	EARS: 7,
	SLEEVES: 8,
	KNEEPADS: 9,
	CHEST: 10,
	PANTS: 11,
	TABARD: 12,
	TROUSERS: 13,
	DH_LOINCLOTH: 14,
	CLOAK: 15,
	FACIAL_JEWELRY: 16,
	EYEGLOW: 17,
	BELT: 18,
	BONE: 19,
	FEET: 20,
	SKULL: 21,
	TORSO: 22,
	HAND_ATTACHMENT: 23,
	HEAD_ATTACHMENT: 24,
	DH_BLINDFOLDS: 25,
	SHOULDERS: 26,
	HELM: 27,
	ARM_UPPER: 28,
	MECHAGNOME_ARMS: 29,
	MECHAGNOME_LEGS: 30,
	MECHAGNOME_FEET: 31,
	HEAD_SWAP: 32,
	EYES: 33,
	EYEBROWS: 34,
	PIERCINGS: 35,
	NECKLACE: 36,
	HEADDRESS: 37,
	TAILS: 38,
	MISC_ACCESSORY: 39,
	MISC_FEATURE: 40,
	NOSES: 41,
	HAIR_DECO_A: 42,
	HORN_DECO: 43,
	BODY_SIZE: 44,
	DRACTHYR: 46,
	EYE_GLOW_B: 51
};

// slot id to geoset group mapping per WoWItem.cpp
const SLOT_GEOSET_MAPPING = {
	1: [
		{ group_index: 0, char_geoset: CG.HELM },
		{ group_index: 1, char_geoset: CG.SKULL }
	],
	3: [
		{ group_index: 0, char_geoset: CG.SHOULDERS }
	],
	4: [
		{ group_index: 0, char_geoset: CG.SLEEVES },
		{ group_index: 1, char_geoset: CG.CHEST }
	],
	5: [
		{ group_index: 0, char_geoset: CG.SLEEVES },
		{ group_index: 1, char_geoset: CG.CHEST },
		{ group_index: 2, char_geoset: CG.TROUSERS },
		{ group_index: 3, char_geoset: CG.TORSO },
		{ group_index: 4, char_geoset: CG.ARM_UPPER }
	],
	6: [
		{ group_index: 0, char_geoset: CG.BELT }
	],
	7: [
		{ group_index: 0, char_geoset: CG.PANTS },
		{ group_index: 1, char_geoset: CG.KNEEPADS },
		{ group_index: 2, char_geoset: CG.TROUSERS }
	],
	8: [
		{ group_index: 0, char_geoset: CG.BOOTS },
		{ group_index: 1, char_geoset: CG.FEET, special_feet: true }
	],
	9: [],
	10: [
		{ group_index: 0, char_geoset: CG.GLOVES },
		{ group_index: 1, char_geoset: CG.HAND_ATTACHMENT }
	],
	15: [
		{ group_index: 0, char_geoset: CG.CLOAK }
	],
	19: [
		{ group_index: 0, char_geoset: CG.TABARD }
	]
};

const GEOSET_PRIORITY = {
	[CG.SLEEVES]: [10, 5, 4],
	[CG.CHEST]: [5, 4],
	[CG.TROUSERS]: [5, 7],
	[CG.TABARD]: [19],
	[CG.CLOAK]: [15],
	[CG.BELT]: [6],
	[CG.FEET]: [8],
	[CG.TORSO]: [5],
	[CG.HAND_ATTACHMENT]: [10],
	[CG.HELM]: [1],
	[CG.ARM_UPPER]: [5],
	[CG.SKULL]: [1],
	[CG.SHOULDERS]: [3],
	[CG.BOOTS]: [8],
	[CG.GLOVES]: [10],
	[CG.PANTS]: [7],
	[CG.KNEEPADS]: [7]
};

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading item geosets...');

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
			const geoset_group = row.GeosetGroup;
			const helmet_geoset_vis = row.HelmetGeosetVis;

			if (geoset_group || helmet_geoset_vis) {
				display_to_geosets.set(display_id, {
					geosetGroup: geoset_group || [0, 0, 0, 0, 0, 0],
					helmetGeosetVis: helmet_geoset_vis || [0, 0]
				});
			}
		}

		for (const row of (await db2.HelmetGeosetData.getAllRows()).values()) {
			const vis_id = row.HelmetGeosetVisDataID;
			const race_id = row.RaceID;
			const hide_group = row.HideGeosetGroup;

			if (!helmet_hide_map.has(vis_id))
				helmet_hide_map.set(vis_id, new Map());

			const race_map = helmet_hide_map.get(vis_id);
			if (!race_map.has(race_id))
				race_map.set(race_id, []);

			race_map.get(race_id).push(hide_group);
		}

		log.write('Loaded geosets for %d item displays, %d helmet visibility rules', display_to_geosets.size, helmet_hide_map.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize();
};

const get_item_geoset_data = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	return display_to_geosets.get(display_id) || null;
};

const get_display_id = (item_id) => {
	return item_to_display_id.get(item_id);
};

const calculate_equipment_geosets = (equipped_items) => {
	const char_geoset_to_slot_values = new Map();

	for (const [slot_id_str, item_id] of Object.entries(equipped_items)) {
		const slot_id = parseInt(slot_id_str);
		const mapping = SLOT_GEOSET_MAPPING[slot_id];

		if (!mapping)
			continue;

		const geoset_data = get_item_geoset_data(item_id);
		if (!geoset_data)
			continue;

		for (const entry of mapping) {
			const group_value = geoset_data.geosetGroup[entry.group_index] || 0;
			const char_geoset = entry.char_geoset;

			let value;
			if (entry.special_feet)
				value = group_value === 0 ? 2 : group_value;
			else
				value = 1 + group_value;

			if (!char_geoset_to_slot_values.has(char_geoset))
				char_geoset_to_slot_values.set(char_geoset, []);

			char_geoset_to_slot_values.get(char_geoset).push({ slot_id, value });
		}
	}

	const result = new Map();

	for (const [char_geoset, slot_values] of char_geoset_to_slot_values) {
		const priority_order = GEOSET_PRIORITY[char_geoset];

		if (priority_order) {
			for (const priority_slot of priority_order) {
				const entry = slot_values.find(sv => sv.slot_id === priority_slot);
				if (entry) {
					result.set(char_geoset, entry.value);
					break;
				}
			}
		} else if (slot_values.length > 0) {
			result.set(char_geoset, slot_values[0].value);
		}
	}

	return result;
};

const get_helmet_hide_geosets = (item_id, race_id, gender_index) => {
	const geoset_data = get_item_geoset_data(item_id);
	if (!geoset_data?.helmetGeosetVis)
		return [];

	const vis_id = geoset_data.helmetGeosetVis[gender_index];
	if (!vis_id)
		return [];

	const race_map = helmet_hide_map.get(vis_id);
	if (!race_map)
		return [];

	return race_map.get(race_id) || [];
};

const get_affected_char_geosets = (equipped_items) => {
	const affected = new Set();

	for (const [slot_id_str, item_id] of Object.entries(equipped_items)) {
		const slot_id = parseInt(slot_id_str);
		const mapping = SLOT_GEOSET_MAPPING[slot_id];

		if (!mapping)
			continue;

		const geoset_data = get_item_geoset_data(item_id);
		if (!geoset_data)
			continue;

		for (const entry of mapping)
			affected.add(entry.char_geoset);
	}

	return affected;
};

const get_geoset_data_by_display_id = (display_id) => {
	return display_to_geosets.get(display_id) || null;
};

const calculate_equipment_geosets_by_display = (slot_display_map) => {
	const char_geoset_to_slot_values = new Map();

	for (const [slot_id, display_id] of slot_display_map) {
		const mapping = SLOT_GEOSET_MAPPING[slot_id];
		if (!mapping)
			continue;

		const geoset_data = display_to_geosets.get(display_id);
		if (!geoset_data)
			continue;

		for (const entry of mapping) {
			const group_value = geoset_data.geosetGroup[entry.group_index] || 0;
			const char_geoset = entry.char_geoset;

			let value;
			if (entry.special_feet)
				value = group_value === 0 ? 2 : group_value;
			else
				value = 1 + group_value;

			if (!char_geoset_to_slot_values.has(char_geoset))
				char_geoset_to_slot_values.set(char_geoset, []);

			char_geoset_to_slot_values.get(char_geoset).push({ slot_id, value });
		}
	}

	const result = new Map();

	for (const [char_geoset, slot_values] of char_geoset_to_slot_values) {
		const priority_order = GEOSET_PRIORITY[char_geoset];

		if (priority_order) {
			for (const priority_slot of priority_order) {
				const entry = slot_values.find(sv => sv.slot_id === priority_slot);
				if (entry) {
					result.set(char_geoset, entry.value);
					break;
				}
			}
		} else if (slot_values.length > 0) {
			result.set(char_geoset, slot_values[0].value);
		}
	}

	return result;
};

const get_affected_char_geosets_by_display = (slot_display_map) => {
	const affected = new Set();

	for (const [slot_id, display_id] of slot_display_map) {
		const mapping = SLOT_GEOSET_MAPPING[slot_id];
		if (!mapping)
			continue;

		const geoset_data = display_to_geosets.get(display_id);
		if (!geoset_data)
			continue;

		for (const entry of mapping)
			affected.add(entry.char_geoset);
	}

	return affected;
};

const get_helmet_hide_geosets_by_display_id = (display_id, race_id, gender_index) => {
	const geoset_data = display_to_geosets.get(display_id);
	if (!geoset_data?.helmetGeosetVis)
		return [];

	const vis_id = geoset_data.helmetGeosetVis[gender_index];
	if (!vis_id)
		return [];

	const race_map = helmet_hide_map.get(vis_id);
	if (!race_map)
		return [];

	return race_map.get(race_id) || [];
};

export {
	initialize,
	ensure_initialized as ensureInitialized,
	get_item_geoset_data as getItemGeosetData,
	get_display_id as getDisplayId,
	calculate_equipment_geosets as calculateEquipmentGeosets,
	get_affected_char_geosets as getAffectedCharGeosets,
	get_helmet_hide_geosets as getHelmetHideGeosets,
	get_geoset_data_by_display_id as getGeosetDataByDisplayId,
	calculate_equipment_geosets_by_display as calculateEquipmentGeosetsByDisplay,
	get_affected_char_geosets_by_display as getAffectedCharGeosetsByDisplay,
	get_helmet_hide_geosets_by_display_id as getHelmetHideGeosetsByDisplayId,
	SLOT_GEOSET_MAPPING,
	GEOSET_PRIORITY,
	CG
};
