const log = require('../../log');
const db2 = require('../../casc/db2');

const categories = new Map();
const subcategories = new Map();
const decor_subcategory_map = new Map();

let is_initialized = false;

const initialize_categories = async () => {
	if (is_initialized)
		return;

	log.write('Loading decor category data...');

	for (const [id, row] of await db2.DecorCategory.getAllRows()) {
		categories.set(id, {
			id,
			name: row.Name_lang || `Category ${id}`,
			orderIndex: row.OrderIndex ?? 0
		});
	}

	for (const [id, row] of await db2.DecorSubcategory.getAllRows()) {
		subcategories.set(id, {
			id,
			name: row.Name_lang || `Subcategory ${id}`,
			categoryID: row.DecorCategoryID ?? 0,
			orderIndex: row.OrderIndex ?? 0
		});
	}

	for (const [, row] of await db2.DecorXDecorSubcategory.getAllRows()) {
		const decor_id = row.HouseDecorID ?? row.DecorID;
		const sub_id = row.DecorSubcategoryID;

		if (decor_id === undefined || sub_id === undefined)
			continue;

		let set = decor_subcategory_map.get(decor_id);
		if (!set) {
			set = new Set();
			decor_subcategory_map.set(decor_id, set);
		}

		set.add(sub_id);
	}

	log.write('Loaded %d decor categories, %d subcategories, %d mappings', categories.size, subcategories.size, decor_subcategory_map.size);
	is_initialized = true;
};

const get_all_categories = () => categories;
const get_all_subcategories = () => subcategories;
const get_subcategories_for_decor = (decor_id) => decor_subcategory_map.get(decor_id) ?? null;

module.exports = {
	initialize_categories,
	get_all_categories,
	get_all_subcategories,
	get_subcategories_for_decor
};
