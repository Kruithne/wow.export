/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const WDCReader = require('../WDCReader');
//const itemNames = new Map();

/**
 * Initialize item data from ItemSparse.db2
 */
const initializeItemData = async () => {
	log.write('Loading item names...');
	const itemSparse = new WDCReader('DBFilesClient/ItemSparse.db2');
	await itemSparse.parse();

	for (const [itemID, itemRow] of itemSparse.getAllRows()) {
		// Test
		console.log(itemID, itemRow);
	}
};

module.exports = {
	initializeItemData
};