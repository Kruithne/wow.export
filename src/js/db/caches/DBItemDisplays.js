/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');
const DBModelFileData = require('./DBModelFileData');
const DBTextureFileData = require('./DBTextureFileData');

const itemDisplays = new Map();
let initialized = false;

/**
 * Initialize item displays from ItemDisplayInfo.db2
 */
const initializeItemDisplays = async () => {
	if (initialized)
		return;

	await DBTextureFileData.ensureInitialized();

	log.write('Loading item textures...');

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [itemDisplayInfoID, itemDisplayInfoRow] of await db2.ItemDisplayInfo.getAllRows()) {
		const modelResIDs = itemDisplayInfoRow.ModelResourcesID.filter(e => e > 0);
		if (modelResIDs.length == 0)
			continue;

		const matResIDs = itemDisplayInfoRow.ModelMaterialResourcesID.filter(e => e > 0);
		if (matResIDs.length == 0)
			continue;

		const modelFileDataIDs = DBModelFileData.getModelFileDataID(modelResIDs[0]);
		const textureFileDataIDs = DBTextureFileData.getTextureFDIDsByMatID(matResIDs[0]);

		if (modelFileDataIDs !== undefined && textureFileDataIDs !== undefined) {
			for (const modelFileDataID of modelFileDataIDs) {
				const display = { ID: itemDisplayInfoID, textures: textureFileDataIDs};

				if (itemDisplays.has(modelFileDataID))
					itemDisplays.get(modelFileDataID).push(display);
				else
					itemDisplays.set(modelFileDataID, [display]);
			}
		}
	}

	log.write('Loaded textures for %d items', itemDisplays.size);
	initialized = true;
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