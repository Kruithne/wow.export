import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';
import { get_slot_id_for_inventory_type } from '../../wow/EquipmentSlots.js';

const ITEM_CLASS_WEAPON = 2;
const ITEM_SUBCLASS_BOW = 2;

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

const is_item_bow = (item_id) => {
	const item = items_by_id.get(item_id);
	if (!item)
		return false;

	return item.classID === ITEM_CLASS_WEAPON && item.subclassID === ITEM_SUBCLASS_BOW;
};

export {
	initialize_items as initialize,
	ensure_initialized as ensureInitialized,
	get_item_by_id as getItemById,
	get_item_slot_id as getItemSlotId,
	is_cache_initialized as isInitialized,
	is_item_bow as isItemBow
};
