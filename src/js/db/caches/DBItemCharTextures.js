/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBTextureFileData = require('./DBTextureFileData');
const DBComponentTextureFileData = require('./DBComponentTextureFileData');

// maps ItemID -> Map<ItemAppearanceModifierID, ItemDisplayInfoID>
const item_to_display_ids = new Map();

// maps ItemDisplayInfoID -> array of { componentSection, materialResourcesID }
const display_to_component_textures = new Map();

let is_initialized = false;
let init_promise = null;

// component section enum (matches CharComponentTextureSections.SectionType)
const COMPONENT_SECTION = {
	ARM_UPPER: 0,
	ARM_LOWER: 1,
	HAND: 2,
	TORSO_UPPER: 3,
	TORSO_LOWER: 4,
	LEG_UPPER: 5,
	LEG_LOWER: 6,
	FOOT: 7,
	ACCESSORY: 8
};

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading item character textures...');

		await DBTextureFileData.ensureInitialized();
		await DBComponentTextureFileData.initialize();

		// build item -> modifier -> appearance -> display chain
		const appearance_map = new Map();
		for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values()) {
			if (!appearance_map.has(row.ItemID))
				appearance_map.set(row.ItemID, new Map());

			appearance_map.get(row.ItemID).set(row.ItemAppearanceModifierID, row.ItemAppearanceID);
		}

		const appearance_to_display = new Map();
		for (const [id, row] of await db2.ItemAppearance.getAllRows())
			appearance_to_display.set(id, row.ItemDisplayInfoID);

		// map item id -> modifier -> display id
		for (const [item_id, modifiers] of appearance_map) {
			for (const [modifier_id, appearance_id] of modifiers) {
				const display_id = appearance_to_display.get(appearance_id);
				if (display_id !== undefined && display_id !== 0) {
					if (!item_to_display_ids.has(item_id))
						item_to_display_ids.set(item_id, new Map());

					item_to_display_ids.get(item_id).set(modifier_id, display_id);
				}
			}
		}

		// load component textures from ItemDisplayInfoMaterialRes
		for (const row of (await db2.ItemDisplayInfoMaterialRes.getAllRows()).values()) {
			const display_id = row.ItemDisplayInfoID;
			const component = {
				section: row.ComponentSection,
				materialResourcesID: row.MaterialResourcesID
			};

			if (display_to_component_textures.has(display_id))
				display_to_component_textures.get(display_id).push(component);
			else
				display_to_component_textures.set(display_id, [component]);
		}

		log.write('Loaded character textures for %d item displays', display_to_component_textures.size);
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
 * Resolve display ID for an item, optionally with a specific modifier.
 * @param {number} item_id
 * @param {number} [modifier_id]
 * @returns {number|undefined}
 */
const resolve_display_id = (item_id, modifier_id) => {
	const modifiers = item_to_display_ids.get(item_id);
	if (!modifiers)
		return undefined;

	if (modifier_id !== undefined)
		return modifiers.get(modifier_id);

	if (modifiers.has(0))
		return modifiers.get(0);

	const sorted = [...modifiers.keys()].sort((a, b) => a - b);
	return modifiers.get(sorted[0]);
};

/**
 * Get character texture components for an item.
 * Returns array of { section, fileDataID } for each body part the item covers.
 * @param {number} item_id
 * @param {number} [race_id] - character race ID for filtering
 * @param {number} [gender_index] - 0=male, 1=female for filtering
 * @param {number} [modifier_id] - item appearance modifier (skin index)
 * @returns {Array<{section: number, fileDataID: number}>|null}
 */
const get_item_textures = (item_id, race_id = null, gender_index = null, modifier_id) => {
	const display_id = resolve_display_id(item_id, modifier_id);
	if (display_id === undefined)
		return null;

	return get_textures_by_display_id(display_id, race_id, gender_index);
};

/**
 * Get ItemDisplayInfoID for an item.
 * @param {number} item_id
 * @param {number} [modifier_id]
 * @returns {number|undefined}
 */
const get_display_id = (item_id, modifier_id) => {
	return resolve_display_id(item_id, modifier_id);
};

/**
 * Get character texture components directly by ItemDisplayInfoID.
 * @param {number} display_id
 * @param {number} [race_id] - character race ID for filtering
 * @param {number} [gender_index] - 0=male, 1=female for filtering
 * @returns {Array<{section: number, fileDataID: number}>|null}
 */
const get_textures_by_display_id = (display_id, race_id = null, gender_index = null) => {
	const components = display_to_component_textures.get(display_id);
	if (components === undefined)
		return null;

	const result = [];
	for (const component of components) {
		const file_data_ids = DBTextureFileData.getTextureFDIDsByMatID(component.materialResourcesID);
		if (file_data_ids && file_data_ids.length > 0) {
			const bestFileDataID = DBComponentTextureFileData.getTextureForRaceGender(file_data_ids, race_id, gender_index);
			result.push({
				section: component.section,
				fileDataID: bestFileDataID
			});
		}
	}

	return result.length > 0 ? result : null;
};

module.exports = {
	initialize,
	ensureInitialized: ensure_initialized,
	getItemTextures: get_item_textures,
	getDisplayId: get_display_id,
	getTexturesByDisplayId: get_textures_by_display_id,
	COMPONENT_SECTION
};
