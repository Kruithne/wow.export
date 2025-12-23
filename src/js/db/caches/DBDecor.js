/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');

const decorItems = new Map();
let isInitialized = false;

/**
 * Initialize house decor data from HouseDecor DB2.
 */
const initializeDecorData = async () => {
	if (isInitialized)
		return;

	log.write('Loading house decor data...');

	for (const [id, row] of await db2.HouseDecor.getAllRows()) {
		const model_file_id = row.ModelFileDataID;
		if (model_file_id === 0)
			continue;

		decorItems.set(id, {
			id,
			name: row.Name_lang || `Decor ${id}`,
			modelFileDataID: model_file_id,
			thumbnailFileDataID: row.ThumbnailFileDataID || 0,
			itemID: row.ItemID || 0,
			gameObjectID: row.GameObjectID || 0,
			type: row.Type || 0,
			modelType: row.ModelType || 0
		});
	}

	log.write('Loaded %d house decor items', decorItems.size);
	isInitialized = true;
};

/**
 * Get all decor items.
 * @returns {Map}
 */
const getAllDecorItems = () => {
	return decorItems;
};

/**
 * Get a decor item by ID.
 * @param {number} id
 * @returns {object|undefined}
 */
const getDecorItemByID = (id) => {
	return decorItems.get(id);
};

/**
 * Get a decor item by model file data ID.
 * @param {number} fileDataID
 * @returns {object|undefined}
 */
const getDecorItemByModelFileDataID = (fileDataID) => {
	for (const item of decorItems.values()) {
		if (item.modelFileDataID === fileDataID)
			return item;
	}

	return undefined;
};

module.exports = {
	initializeDecorData,
	getAllDecorItems,
	getDecorItemByID,
	getDecorItemByModelFileDataID
};
