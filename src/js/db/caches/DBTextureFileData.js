/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../../log');
const WDCReader = require('../WDCReader');

const matResIDToFileDataID = new Map();
const fileDataIDs = new Set();

/**
 * Initialize texture file data ID from TextureFileData.db2
 */
const initializeTextureFileData = async () => {
	log.write('Loading texture mapping...');
	const textureFileData = new WDCReader('DBFilesClient/TextureFileData.db2');
	await textureFileData.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [textureFileDataID, textureFileDataRow] of textureFileData.getAllRows()) {
		// Keep a list of all FIDs for listfile unknowns.
		fileDataIDs.add(textureFileDataID);

		// TODO: Need to remap this to support other UsageTypes
		if (textureFileDataRow.UsageType !== 0)
			continue;

		if (matResIDToFileDataID.has(textureFileDataRow.MaterialResourcesID))
			matResIDToFileDataID.get(textureFileDataRow.MaterialResourcesID).push(textureFileDataID);
		else
			matResIDToFileDataID.set(textureFileDataRow.MaterialResourcesID, [textureFileDataID]);
	}
	log.write('Loaded texture mapping for %d materials', matResIDToFileDataID.size);
};

/**
 * Retrieves texture file data IDs by a material resource ID.
 * @param {number} matResID 
 * @returns {?number[]}
 */
const getTextureFDIDsByMatID = (matResID) => {
	return matResIDToFileDataID.get(matResID);
};

/**
 * Ensure texture file data is initialized. Call this before using other functions.
 * @returns {Promise<void>}
 */
const ensureInitialized = async () => {
	if (matResIDToFileDataID.size === 0)
		await initializeTextureFileData();
};

/**
 * Retrieve a list of all file data IDs cached from TextureFileData.db2
 * NOTE: This is reset once called by the listfile module; adjust if needed elsewhere.
 * @returns {Set}
 */
const getFileDataIDs = () => {
	return fileDataIDs;
};

module.exports = {
	initializeTextureFileData,
	ensureInitialized,
	getTextureFDIDsByMatID,
	getFileDataIDs
};