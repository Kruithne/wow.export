/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');

const WDCReader = require('../db/WDCReader');
const ItemSlot = require('../wow/ItemSlot');

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

	core.view.listfileItems = items;

	// Show the item viewer screen.
	core.view.loadPct = -1;
	core.view.isBusy--;
	core.view.setScreen('tab-items');
});