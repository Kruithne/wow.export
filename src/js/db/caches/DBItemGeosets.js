/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

// maps ItemDisplayInfoID -> geoset data
const display_to_geosets = new Map();

let is_initialized = false;
let init_promise = null;

// geoset group enum (matches CharGeosets from WMV)
// the value * 100 gives the geoset base
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
	EYEGLOW: 17,
	BELT: 18,
	BONE: 19,
	FEET: 20,
	GEOSET2100: 21,
	TORSO: 22,
	HAND_ATTACHMENT: 23,
	HEAD_ATTACHMENT: 24,
	DH_BLINDFOLDS: 25,
	GEOSET2600: 26,
	GEOSET2700: 27,
	GEOSET2800: 28
};

// slot id to geoset group mapping per WoWItem.cpp
// each entry: { group_index: index in GeosetGroup array, char_geoset: CG enum value }
const SLOT_GEOSET_MAPPING = {
	// Head: geosetGroup[0] = CG_GEOSET2700, geosetGroup[1] = CG_GEOSET2100
	1: [
		{ group_index: 0, char_geoset: CG.GEOSET2700 },
		{ group_index: 1, char_geoset: CG.GEOSET2100 }
	],
	// Shoulder: geosetGroup[0] = CG_GEOSET2600
	3: [
		{ group_index: 0, char_geoset: CG.GEOSET2600 }
	],
	// Shirt: geosetGroup[0] = CG_SLEEVES, geosetGroup[1] = CG_CHEST
	4: [
		{ group_index: 0, char_geoset: CG.SLEEVES },
		{ group_index: 1, char_geoset: CG.CHEST }
	],
	// Chest: geosetGroup[0] = CG_SLEEVES, geosetGroup[1] = CG_CHEST, geosetGroup[2] = CG_TROUSERS, geosetGroup[3] = CG_TORSO, geosetGroup[4] = CG_GEOSET2800
	5: [
		{ group_index: 0, char_geoset: CG.SLEEVES },
		{ group_index: 1, char_geoset: CG.CHEST },
		{ group_index: 2, char_geoset: CG.TROUSERS },
		{ group_index: 3, char_geoset: CG.TORSO },
		{ group_index: 4, char_geoset: CG.GEOSET2800 }
	],
	// Waist/Belt: geosetGroup[0] = CG_BELT
	6: [
		{ group_index: 0, char_geoset: CG.BELT }
	],
	// Pants/Legs: geosetGroup[0] = CG_PANTS, geosetGroup[1] = CG_KNEEPADS, geosetGroup[2] = CG_TROUSERS
	7: [
		{ group_index: 0, char_geoset: CG.PANTS },
		{ group_index: 1, char_geoset: CG.KNEEPADS },
		{ group_index: 2, char_geoset: CG.TROUSERS }
	],
	// Boots/Feet: geosetGroup[0] = CG_BOOTS, geosetGroup[1] = CG_FEET (special handling)
	8: [
		{ group_index: 0, char_geoset: CG.BOOTS },
		{ group_index: 1, char_geoset: CG.FEET, special_feet: true }
	],
	// Wrist/Bracers: no geoset groups
	9: [],
	// Hands/Gloves: geosetGroup[0] = CG_GLOVES, geosetGroup[1] = CG_HAND_ATTACHMENT
	10: [
		{ group_index: 0, char_geoset: CG.GLOVES },
		{ group_index: 1, char_geoset: CG.HAND_ATTACHMENT }
	],
	// Back/Cloak: geosetGroup[0] = CG_CLOAK
	15: [
		{ group_index: 0, char_geoset: CG.CLOAK }
	],
	// Tabard: geosetGroup[0] = CG_TABARD
	19: [
		{ group_index: 0, char_geoset: CG.TABARD }
	]
};

// priority system for conflicting geoset groups
// when multiple slots affect the same char_geoset, higher priority wins
// order: first slot in array has highest priority
const GEOSET_PRIORITY = {
	[CG.SLEEVES]: [10, 5, 4],      // gloves > chest > shirt
	[CG.CHEST]: [5, 4],            // chest > shirt
	[CG.TROUSERS]: [5, 7],         // chest > pants
	[CG.TABARD]: [19],             // tabard only
	[CG.CLOAK]: [15],              // cloak only
	[CG.BELT]: [6],                // belt only
	[CG.FEET]: [8],                // boots only
	[CG.TORSO]: [5],               // chest only
	[CG.HAND_ATTACHMENT]: [10],    // gloves only
	[CG.GEOSET2700]: [1],          // head only
	[CG.GEOSET2800]: [5],          // chest only
	[CG.GEOSET2100]: [1],          // head only
	[CG.GEOSET2600]: [3],          // shoulder only
	[CG.BOOTS]: [8],               // boots only
	[CG.GLOVES]: [10],             // gloves only
	[CG.PANTS]: [7],               // pants only
	[CG.KNEEPADS]: [7]             // pants only
};

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading item geosets...');

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

		// load geoset groups from ItemDisplayInfo
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

		log.write('Loaded geosets for %d item displays', display_to_geosets.size);
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
 * Get geoset data for an item's display.
 * @param {number} item_id
 * @returns {{geosetGroup: number[], helmetGeosetVis: number[]}|null}
 */
const get_item_geoset_data = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	return display_to_geosets.get(display_id) || null;
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
 * Calculate geoset visibility changes for equipped items.
 * Returns a map of char_geoset (CG enum) -> value to show.
 * The actual geoset ID = char_geoset * 100 + value.
 * @param {Object} equipped_items - Map of slot_id -> item_id
 * @returns {Map<number, number>} - Map of char_geoset -> value
 */
const calculate_equipment_geosets = (equipped_items) => {
	// track values per char_geoset, grouped by slot for priority resolution
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

			// calculate the value to use (WMV uses 1 + geosetGroup[n] for most)
			let value;
			if (entry.special_feet) {
				// CG_FEET special handling per WoWItem.cpp:
				// if geosetGroup[1] == 0, use 2
				// if geosetGroup[1] > 0, use geosetGroup[1]
				value = group_value === 0 ? 2 : group_value;
			} else {
				value = 1 + group_value;
			}

			if (!char_geoset_to_slot_values.has(char_geoset))
				char_geoset_to_slot_values.set(char_geoset, []);

			char_geoset_to_slot_values.get(char_geoset).push({ slot_id, value });
		}
	}

	// resolve priorities and build final result
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

/**
 * Get the set of char_geosets (CG enum values) that are affected by equipped items.
 * @param {Object} equipped_items - Map of slot_id -> item_id
 * @returns {Set<number>}
 */
const get_affected_char_geosets = (equipped_items) => {
	const affected = new Set();

	for (const [slot_id_str] of Object.entries(equipped_items)) {
		const slot_id = parseInt(slot_id_str);
		const mapping = SLOT_GEOSET_MAPPING[slot_id];

		if (!mapping)
			continue;

		for (const entry of mapping)
			affected.add(entry.char_geoset);
	}

	return affected;
};

module.exports = {
	initialize,
	ensureInitialized: ensure_initialized,
	getItemGeosetData: get_item_geoset_data,
	getDisplayId: get_display_id,
	calculateEquipmentGeosets: calculate_equipment_geosets,
	getAffectedCharGeosets: get_affected_char_geosets,
	SLOT_GEOSET_MAPPING,
	GEOSET_PRIORITY,
	CG
};
