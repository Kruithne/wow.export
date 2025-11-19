/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');

const modelResIDToFileDataID = new Map();
const fileDataIDs = new Set();
let initialized = false;

/**
 * Initialize model file data from ModelFileData.db2
 */
const initializeModelFileData = async () => {
	if (initialized)
		return;

	log.write('Loading model mapping...');

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelFileDataID, modelFileDataRow] of await db2.ModelFileData.getAllRows()) {
		// Keep a list of all FIDs for listfile unknowns.
		fileDataIDs.add(modelFileDataID);

		if (modelResIDToFileDataID.has(modelFileDataRow.ModelResourcesID))
			modelResIDToFileDataID.get(modelFileDataRow.ModelResourcesID).push(modelFileDataID);
		else
			modelResIDToFileDataID.set(modelFileDataRow.ModelResourcesID, [modelFileDataID]);
	}
	log.write('Loaded model mapping for %d models', modelResIDToFileDataID.size);
	initialized = true;
};

/**
 * Retrieve a model file data ID.
 * @param {number} modelResID 
 * @returns {?number}
 */
const getModelFileDataID = (modelResID) => {
	return modelResIDToFileDataID.get(modelResID);
};

/**
 * Retrieve a list of all file data IDs cached from ModelFileData.db2
 * NOTE: This is reset once called by the listfile module; adjust if needed elsewhere.
 * @returns {Set}
 */
const getFileDataIDs = () => {
	return fileDataIDs;
};

module.exports = {
	initializeModelFileData,
	getModelFileDataID,
	getFileDataIDs
};