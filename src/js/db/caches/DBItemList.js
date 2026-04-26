const log = require('../../log');
const db2 = require('../../casc/db2');
const DBItems = require('./DBItems');
const DBModelFileData = require('./DBModelFileData');
const DBTextureFileData = require('./DBTextureFileData');
const MultiMap = require('../../MultiMap');
const listfile = require('../../casc/listfile');

const ITEM_SLOTS_IGNORED = [0, 18, 11, 12, 24, 25, 27, 28];

class Item {
	constructor(id, item_sparse_row, item_appearance_row, textures, models) {
		this.id = id;
		this.name = item_sparse_row.Display_lang;

		if (this.name === undefined)
			this.name = 'Unknown item #' + id;

		this.inventoryType = item_sparse_row.InventoryType;
		this.quality = item_sparse_row.OverallQualityID ?? 0;

		this.icon = item_appearance_row?.DefaultIconFileDataID ?? 0;

		if (this.icon == 0)
			this.icon = item_sparse_row.IconFileDataID;

		this.models = models;
		this.textures = textures;

		this.modelCount = this.models?.length ?? 0;
		this.textureCount = this.textures?.length ?? 0;
	}

	get itemSlotName() {
		const ItemSlot = require('../../wow/ItemSlot');
		return ItemSlot.getSlotName(this.inventoryType);
	}

	get displayName() {
		return this.name + ' (' + this.id + ')';
	}
}

let items = [];
let is_initialized = false;
let init_promise = null;

const initialize = async (progress_fn) => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		if (progress_fn)
			await progress_fn('Loading model file data...');

		await DBModelFileData.initializeModelFileData();

		if (progress_fn)
			await progress_fn('Loading item data...');

		await DBItems.ensureInitialized();

		const item_sparse_rows = await db2.ItemSparse.getAllRows();

		const appearance_map = new Map();
		for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
			appearance_map.set(row.ItemID, row.ItemAppearanceID);

		const material_map = new MultiMap();
		for (const row of (await db2.ItemDisplayInfoMaterialRes.getAllRows()).values())
			material_map.set(row.ItemDisplayInfoID, row.MaterialResourcesID);

		for (const [item_id, item_row] of item_sparse_rows) {
			if (ITEM_SLOTS_IGNORED.includes(item_row.inventoryType))
				continue;

			const item_appearance_id = appearance_map.get(item_id);
			const item_appearance_row = await db2.ItemAppearance.getRow(item_appearance_id);

			let materials = null;
			let models = null;
			if (item_appearance_row !== null) {
				materials = [];
				models = [];

				const item_display_info_row = await db2.ItemDisplayInfo.getRow(item_appearance_row.ItemDisplayInfoID);
				if (item_display_info_row !== null) {
					materials.push(...item_display_info_row.ModelMaterialResourcesID);
					models.push(...item_display_info_row.ModelResourcesID);
				}

				const material_res = material_map.get(item_appearance_row.ItemDisplayInfoID);
				if (material_res !== undefined)
					Array.isArray(material_res) ? materials.push(...material_res) : materials.push(material_res);

				materials = materials.filter(e => e !== 0);
				models = models.filter(e => e !== 0);
			}

			items.push(Object.freeze(new Item(item_id, item_row, item_appearance_row, materials, models)));
		}

		log.write('DBItemList: loaded %d items', items.length);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const load_show_all_items = async () => {
	const item_sparse_rows = await db2.ItemSparse.getAllRows();
	const item_db = db2.Item;

	const appearance_map = new Map();
	for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
		appearance_map.set(row.ItemID, row.ItemAppearanceID);

	const material_map = new MultiMap();
	for (const row of (await db2.ItemDisplayInfoMaterialRes.getAllRows()).values())
		material_map.set(row.ItemDisplayInfoID, row.MaterialResourcesID);

	for (const [item_id, item_row] of await item_db.getAllRows()) {
		if (ITEM_SLOTS_IGNORED.includes(item_row.inventoryType))
			continue;

		if (item_sparse_rows.has(item_id))
			continue;

		items.push(Object.freeze(new Item(item_id, item_row, null, null, null)));
	}
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize();
};

const get_items = () => items;

const get_item_models = (item) => {
	if (!item.models)
		return [];

	const list = new Set();
	for (const model_id of item.models) {
		const file_data_ids = DBModelFileData.getModelFileDataID(model_id);
		for (const file_data_id of file_data_ids) {
			const entry = listfile.getByID(file_data_id);
			if (entry !== undefined)
				list.add(`${entry} [${file_data_id}]`);
		}
	}

	return [...list];
};

const get_item_textures = async (item) => {
	if (!item.textures)
		return [];

	await DBTextureFileData.ensureInitialized();

	const list = new Set();
	for (const texture_id of item.textures) {
		const file_data_ids = DBTextureFileData.getTextureFDIDsByMatID(texture_id);
		if (file_data_ids) {
			for (const file_data_id of file_data_ids) {
				const entry = listfile.getByID(file_data_id);
				if (entry !== undefined)
					list.add(`${entry} [${file_data_id}]`);
			}
		}
	}

	return [...list];
};

module.exports = {
	Item,
	ITEM_SLOTS_IGNORED,
	initialize,
	ensureInitialized: ensure_initialized,
	getItems: get_items,
	getItemModels: get_item_models,
	getItemTextures: get_item_textures,
	loadShowAllItems: load_show_all_items
};
