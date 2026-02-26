/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');

const creatureDisplays = new Map();
const creatureDisplayInfoMap = new Map();
const displayIDToFileDataID = new Map();
let isInitialized = false;

/**
 * Initialize creature data.
 */
const initializeCreatureData = async () => {
	if (isInitialized)
		return;

	log.write('Loading creature textures...');

	const creatureGeosetMap = new Map();
	const creatureDisplayInfoGeosetData = db2.CreatureDisplayInfoGeosetData;
	// CreatureDisplayInfoID => Array of geosets to enable which should only be used if CreatureModelData.CreatureDisplayInfoGeosetData != 0
	for (const geosetRow of (await creatureDisplayInfoGeosetData.getAllRows()).values()) {
		if (!creatureGeosetMap.has(geosetRow.CreatureDisplayInfoID))
			creatureGeosetMap.set(geosetRow.CreatureDisplayInfoID, new Array());

		creatureGeosetMap.get(geosetRow.CreatureDisplayInfoID).push((geosetRow.GeosetIndex + 1) * 100 + geosetRow.GeosetValue);
	}

	const modelIDToDisplayInfoMap = new Map();

	// Map all available texture fileDataIDs to model IDs.
	for (const [displayID, displayRow] of await db2.CreatureDisplayInfo.getAllRows()) {
		creatureDisplayInfoMap.set(displayID, { ID: displayID, modelID: displayRow.ModelID, extendedDisplayInfoID: displayRow.ExtendedDisplayInfoID, textures: displayRow.TextureVariationFileDataID.filter(e => e > 0)})
		
		if (modelIDToDisplayInfoMap.has(displayRow.ModelID))
			modelIDToDisplayInfoMap.get(displayRow.ModelID).push(displayID);
		else
			modelIDToDisplayInfoMap.set(displayRow.ModelID, [displayID]);
	}

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelID, modelRow] of await db2.CreatureModelData.getAllRows()) {
		if (modelIDToDisplayInfoMap.has(modelID)) {
			const fileDataID = modelRow.FileDataID;
			const displayIDs = modelIDToDisplayInfoMap.get(modelID);
			const modelIDHasExtraGeosets = modelRow.CreatureGeosetDataID > 0;

			for (const displayID of displayIDs) {
				displayIDToFileDataID.set(displayID, fileDataID);

				const display = creatureDisplayInfoMap.get(displayID);

				if (modelIDHasExtraGeosets) {
					display.extraGeosets = Array();
					if (creatureGeosetMap.has(displayID))
						display.extraGeosets = creatureGeosetMap.get(displayID);
				}

				if (creatureDisplays.has(fileDataID))
					creatureDisplays.get(fileDataID).push(display);
				else
					creatureDisplays.set(fileDataID, [display]);
			}
		}
	}

	log.write('Loaded textures for %d creatures', creatureDisplays.size);
	isInitialized = true;
};

/**
 * Gets creature skins from a given file data ID.
 * @param {number} fileDataID 
 * @returns {string|undefined}
 */
const getCreatureDisplaysByFileDataID = (fileDataID) => {
	return creatureDisplays.get(fileDataID);
};

/**
 * Gets the file data ID for a given display ID.
 */
const getFileDataIDByDisplayID = (displayID) => {
	return displayIDToFileDataID.get(displayID);
}

const getDisplayInfo = (displayID) => {
	return creatureDisplayInfoMap.get(displayID);
};

module.exports = {
	initializeCreatureData,
	getCreatureDisplaysByFileDataID,
	getFileDataIDByDisplayID,
	getDisplayInfo
};