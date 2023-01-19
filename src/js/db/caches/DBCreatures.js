/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const log = require('../../log');
const WDCReader = require('../WDCReader');

const creatureDisplays = new Map();

/**
 * Initialize creature data.
 * @param {WDCReader} creatureDisplayInfo
 * @param {WDCReader} creatureModelData
 */
const initializeCreatureData = async (creatureDisplayInfo, creatureModelData) => {
	log.write('Loading creature textures...');

	const creatureGeosetMap = new Map();

	const creatureDisplayInfoGeosetData = new WDCReader('DBFilesClient/CreatureDisplayInfoGeosetData.db2');
	await creatureDisplayInfoGeosetData.parse();
	// CreatureDisplayInfoID => Array of geosets to enable which should only be used if CreatureModelData.CreatureDisplayInfoGeosetData != 0
	for (const geosetRow of creatureDisplayInfoGeosetData.getAllRows().values()) {
		if (!creatureGeosetMap.has(geosetRow.CreatureDisplayInfoID))
			creatureGeosetMap.set(geosetRow.CreatureDisplayInfoID, []);

		creatureGeosetMap.get(geosetRow.CreatureDisplayInfoID).push((geosetRow.GeosetIndex + 1) * 100 + geosetRow.GeosetValue);
	}

	const creatureDisplayInfoMap = new Map();
	const modelIDToDisplayInfoMap = new Map();

	// Map all available texture fileDataIDs to model IDs.
	for (const [displayID, displayRow] of creatureDisplayInfo.getAllRows()) {
		creatureDisplayInfoMap.set(displayID, { ID: displayID, modelID: displayRow.ModelID, textures: displayRow.TextureVariationFileDataID.filter(e => e > 0)});

		if (modelIDToDisplayInfoMap.has(displayRow.ModelID))
			modelIDToDisplayInfoMap.get(displayRow.ModelID).push(displayID);
		else
			modelIDToDisplayInfoMap.set(displayRow.ModelID, [displayID]);
	}

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelID, modelRow] of creatureModelData.getAllRows()) {
		if (modelIDToDisplayInfoMap.has(modelID)) {
			const fileDataID = modelRow.FileDataID;
			const displayIDs = modelIDToDisplayInfoMap.get(modelID);
			const modelIDHasExtraGeosets = modelRow.CreatureGeosetDataID > 0;

			for (const displayID of displayIDs) {
				const display = creatureDisplayInfoMap.get(displayID);

				if (modelIDHasExtraGeosets) {
					display.extraGeosets = [];
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
};

/**
 * Gets creature skins from a given file data ID.
 * @param {number} fileDataID
 * @returns {string|undefined}
 */
const getCreatureDisplaysByFileDataID = (fileDataID) => {
	return creatureDisplays.get(fileDataID);
};

module.exports = {
	initializeCreatureData,
	getCreatureDisplaysByFileDataID
};