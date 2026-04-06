/*!
	wow.export (https://github.com/Kruithne/wow.export)
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');
const DBTextureFileData = require('./DBTextureFileData');

const itemDisplays = new Map();
let is_initialized = false;

/**
 * Initialize Item Display Info Model Mat Res DB2.
 */
const initializeIDIMMR = async () => {
	if (is_initialized)
		return;

	await DBTextureFileData.ensureInitialized();

	log.write('Loading item display info model mat res...');

	for (const [id, row] of await db2.ItemDisplayInfoModelMatRes.getAllRows()) {
		const id = row.ID;
		if (id === 0)
			continue;
		const itemdisplayinfoid = row.ItemDisplayInfoID;
		const matresid = row.MaterialResourcesID;
		const textureFileDataIDs = DBTextureFileData.getTextureFDIDsByMatID(matresid);

		if (textureFileDataIDs !== undefined) {
			if (itemDisplays.has(itemdisplayinfoid))
				itemDisplays.get(itemdisplayinfoid).push(...textureFileDataIDs);
			else
				itemDisplays.set(itemdisplayinfoid, [...textureFileDataIDs]);
		}
	}

	log.write('Loaded %d item display info model mat res items', itemDisplays.size);
	is_initialized = true;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initializeIDIMMR();
};

/**
 * Get texturefile id's by ItemDisplayInfoId
 * @param {number} ItemDisplayInfoId
 * @returns {number[]|undefined}
 */
const getItemDisplayIdTextureFileIds = (ItemDisplayInfoId) => {
	return itemDisplays.get(ItemDisplayInfoId);
};

module.exports = {
	initialize: initializeIDIMMR,
	ensureInitialized: ensure_initialized,
	getItemDisplayIdTextureFileIds,
};
