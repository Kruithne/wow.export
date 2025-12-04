/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');
const { get_slot_for_inventory_type } = require('../../wow/EquipmentSlots');

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

		const item_sparse_rows = await db2.ItemSparse.getAllRows();

		for (const [item_id, item_row] of item_sparse_rows) {
			items_by_id.set(item_id, {
				id: item_id,
				name: item_row.Display_lang ?? 'Unknown item #' + item_id,
				inventoryType: item_row.InventoryType,
				quality: item_row.OverallQualityID ?? 0
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

const get_item_slot = (item_id) => {
	const item = items_by_id.get(item_id);
	if (!item)
		return null;

	return get_slot_for_inventory_type(item.inventoryType);
};

const is_cache_initialized = () => {
	return is_initialized;
};

module.exports = {
	initialize: initialize_items,
	ensureInitialized: ensure_initialized,
	getItemById: get_item_by_id,
	getItemSlot: get_item_slot,
	isInitialized: is_cache_initialized
};
