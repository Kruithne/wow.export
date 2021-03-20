/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');

const WDCReader = require('../db/WDCReader');
const ItemSlot = require('../wow/ItemSlot');

const ITEM_SLOTS_MERGED = {
	'Miscellaneous': [0, 18, 11, 12, 24, 25, 27, 28],
	'Head': [1],
	'Neck': [2],
	'Shoulder': [3],
	'Shirt': [4],
	'Chest': [5, 20],
	'Waist': [6],
	'Legs': [7],
	'Feet': [8],
	'Wrist': [9],
	'Hands': [10],
	'One-hand': [13],
	'Off-hand': [14, 22, 23],
	'Two-hand': [17],
	'Main-hand': [21],
	'Ranged': [15, 26],
	'Back': [16],
	'Tabard': [19]
};

class Item {
	/**
	 * Construct a new Item instance.
	 * @param {number} id 
	 * @param {object} itemSparseRow 
	 * @param {?object} itemAppearanceRow
	 */
	constructor(id, itemSparseRow, itemAppearanceRow) {
		this.id = id;
		this.name = itemSparseRow.Display_lang;
		this.inventoryType = itemSparseRow.InventoryType;
		this.quality = itemSparseRow.OverallQualityID;

		this.icon = itemAppearanceRow?.DefaultIconFileDataID ?? 0;
	}

	/**
	 * Returns item slot name for this items inventory type.
	 * @returns {string}
	 */
	get itemSlotName() {
		return ItemSlot.getSlotName(this.inventoryType);
	}
}

core.events.once('screen-tab-items', async () => {
	// Initialize a loading screen.
	const progress = core.createProgress(3);
	core.view.setScreen('loading');
	core.view.isBusy++;

	await progress.step('Loading item data...');
	const itemSparse = new WDCReader('DBFilesClient/ItemSparse.db2');
	await itemSparse.parse();

	await progress.step('Loading item appearances...');
	const itemModifiedAppearance = new WDCReader('DBFilesClient/ItemModifiedAppearance.db2');
	await itemModifiedAppearance.parse();

	const itemAppearance = new WDCReader('DBFilesClient/ItemAppearance.db2');
	await itemAppearance.parse();

	await progress.step('Building item relationships...');

	const rows = itemSparse.getAllRows();
	const items = Array(rows.size);

	const appearanceMap = new Map();
	for (const row of itemModifiedAppearance.getAllRows().values())
		appearanceMap.set(row.ItemID, row.ItemAppearanceID);

	let index = 0;
	for (const [itemID, itemRow] of rows) {
		const itemAppearanceID = appearanceMap.get(itemID);
		const itemAppearanceRow = itemAppearance.getRow(itemAppearanceID);
		items[index++] = Object.freeze(new Item(itemID, itemRow, itemAppearanceRow));
	}

	//core.view.listfileItems = items;

	// Show the item viewer screen.
	core.view.loadPct = -1;
	core.view.isBusy--;
	core.view.setScreen('tab-items');

	// Load initial configuration for the type control from config.
	const enabledTypes = core.view.config.itemViewerEnabledTypes;
	const mask = [];

	for (const label of Object.keys(ITEM_SLOTS_MERGED))
		mask.push({ label, checked: enabledTypes.includes(label) });

	// Register a watcher for the item type control.
	core.view.$watch('itemViewerTypeMask', () => {
		// Refilter the listfile based on what the new selection.
		const filter = core.view.itemViewerTypeMask.filter(e => e.checked);
		const mask = [];

		filter.forEach(e => mask.push(...ITEM_SLOTS_MERGED[e.label]));
		const test = items.filter(item => mask.includes(item.inventoryType));
		core.view.listfileItems = test;

		// Save just the names of user enabled types, preventing incompatibilities if we change things.
		core.view.config.itemViewerEnabledTypes = core.view.itemViewerTypeMask.map(e => e.label);
	}, { deep: true });

	core.view.itemViewerTypeMask = mask;
});