/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');
const { get_slot_id_for_inventory_type } = require('../../wow/EquipmentSlots');

const items_by_id = new Map();
let is_initialized = false;
let init_promise = null;

const initialize_items = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading item cache...');

		// load item class/subclass from Item table
		const item_class_map = new Map();
		const item_rows = await db2.Item.getAllRows();
		for (const [item_id, item_row] of item_rows) {
			item_class_map.set(item_id, {
				classID: item_row.ClassID,
				subclassID: item_row.SubclassID
			});
		}

		const item_sparse_rows = await db2.ItemSparse.getAllRows();

		for (const [item_id, item_row] of item_sparse_rows) {
			const class_info = item_class_map.get(item_id);
			items_by_id.set(item_id, {
				id: item_id,
				name: item_row.Display_lang ?? 'Unknown item #' + item_id,
				inventoryType: item_row.InventoryType,
				quality: item_row.OverallQualityID ?? 0,
				classID: class_info?.classID ?? 0,
				subclassID: class_info?.subclassID ?? 0
			});
		}

		log.write('Loaded %d items into cache', items_by_id.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize_items();
};

const get_item_by_id = (item_id) => {
	return items_by_id.get(item_id) ?? null;
};

const get_item_slot_id = (item_id) => {
	const item = items_by_id.get(item_id);
	if (!item)
		return null;

	return get_slot_id_for_inventory_type(item.inventoryType);
};

const is_cache_initialized = () => {
	return is_initialized;
};

// item class 2 = Weapon, subclass 2 = Bow
const ITEM_CLASS_WEAPON = 2;
const ITEM_SUBCLASS_BOW = 2;

const is_item_bow = (item_id) => {
	const item = items_by_id.get(item_id);
	if (!item)
		return false;

	return item.classID === ITEM_CLASS_WEAPON && item.subclassID === ITEM_SUBCLASS_BOW;
};

module.exports = {
	initialize: initialize_items,
	ensureInitialized: ensure_initialized,
	getItemById: get_item_by_id,
	getItemSlotId: get_item_slot_id,
	isInitialized: is_cache_initialized,
	isItemBow: is_item_bow
};
