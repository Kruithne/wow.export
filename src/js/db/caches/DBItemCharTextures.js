/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBTextureFileData = require('./DBTextureFileData');

// maps ItemID -> ItemDisplayInfoID
const item_to_display_id = new Map();

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
 * Get character texture components for an item.
 * Returns array of { section, fileDataID } for each body part the item covers.
 * @param {number} item_id
 * @returns {Array<{section: number, fileDataID: number}>|null}
 */
const get_item_textures = (item_id) => {
	const display_id = item_to_display_id.get(item_id);
	if (display_id === undefined)
		return null;

	const components = display_to_component_textures.get(display_id);
	if (components === undefined)
		return null;

	const result = [];
	for (const component of components) {
		const file_data_ids = DBTextureFileData.getTextureFDIDsByMatID(component.materialResourcesID);
		if (file_data_ids && file_data_ids.length > 0) {
			result.push({
				section: component.section,
				fileDataID: file_data_ids[0]
			});
		}
	}

	return result.length > 0 ? result : null;
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
 * Get character texture components directly by ItemDisplayInfoID.
 * @param {number} display_id
 * @returns {Array<{section: number, fileDataID: number}>|null}
 */
const get_textures_by_display_id = (display_id) => {
	const components = display_to_component_textures.get(display_id);
	if (components === undefined)
		return null;

	const result = [];
	for (const component of components) {
		const file_data_ids = DBTextureFileData.getTextureFDIDsByMatID(component.materialResourcesID);
		if (file_data_ids && file_data_ids.length > 0) {
			result.push({
				section: component.section,
				fileDataID: file_data_ids[0]
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
