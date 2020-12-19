/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../../log');
const WDCReader = require('../WDCReader');
const DBModelFileData = require('./DBModelFileData');
const DBTextureFileData = require('./DBTextureFileData');

const itemDisplays = new Map();

/**
 * Initialize item displays from ItemDisplayInfo.db2
 */
const initializeItemDisplays = async () => {
	log.write('Loading item textures...');
	const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.db2');
	await itemDisplayInfo.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [itemDisplayInfoID, itemDisplayInfoRow] of itemDisplayInfo.getAllRows()) {
		const modelResIDs = itemDisplayInfoRow.ModelResourcesID.filter(e => e > 0);
		if (modelResIDs.length == 0)
			continue;

		const matResIDs = itemDisplayInfoRow.ModelMaterialResourcesID.filter(e => e > 0);
		if (matResIDs.length == 0)
			continue;

		const modelFileDataIDs = DBModelFileData.getModelFileDataID(modelResIDs[0]);
		const textureFileDataID = DBTextureFileData.getTextureFileDataID(matResIDs[0]);

		if (modelFileDataIDs !== undefined && textureFileDataID !== undefined) {
			for (const modelFileDataID of modelFileDataIDs) {
				const display = { ID: itemDisplayInfoID, textures: [textureFileDataID]};

				if (itemDisplays.has(modelFileDataID))
					itemDisplays.get(modelFileDataID).push(display);
				else
					itemDisplays.set(modelFileDataID, [display]);
			}
		}
	}

	log.write('Loaded textures for %d items', itemDisplays.size);
};

/**
 * Gets item skins from a given file data ID.
 * @param {number} fileDataID 
 * @returns {string|undefined}
 */
const getItemDisplaysByFileDataID = (fileDataID) => {
	return itemDisplays.get(fileDataID);
};

module.exports = {
	initializeItemDisplays,
	getItemDisplaysByFileDataID
};