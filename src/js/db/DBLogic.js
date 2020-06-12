/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const listfile = require('../casc/listfile');

const WDCReader = require('../db/WDCReader');

const DB_CreatureDisplayInfo = require('../db/schema/CreatureDisplayInfo');
const DB_CreatureModelData = require('../db/schema/CreatureModelData');
const DB_ChrModel = require('../db/schema/ChrModel');
const DB_ChrCustomization = require('../db/schema/ChrCustomization');
// const DB_ChrCustomizationCategory = require('../db/schema/ChrCustomizationCategory');
const DB_ChrCustomizationChoice = require('../db/schema/ChrCustomizationChoice');
const DB_ChrCustomizationOption = require('../db/schema/ChrCustomizationOption');

const creatureTextures = new Map();
const fdidToChrModel = new Map();

let chrCustomizationAvailable = false;

/**
 * Loads required tables.
 */
const loadTables = async () => { 
	log.write('Loading creature textures...');

	const creatureDisplayInfo = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2', DB_CreatureDisplayInfo);
	await creatureDisplayInfo.parse();

	const textureMap = new Map();

	// Map all available texture fileDataIDs to model IDs.
	for (const displayRow of creatureDisplayInfo.getAllRows().values()) {
		const textures = displayRow.TextureVariationFileDataID.filter(e => e > 0);

		if (textures.length > 0) {
			if (textureMap.has(displayRow.ModelID))
				textureMap.get(displayRow.ModelID).push(...textures);
			else
				textureMap.set(displayRow.ModelID, textures);
		}
	}

	const creatureModelData = new WDCReader('DBFilesClient/CreatureModelData.db2', DB_CreatureModelData);
	await creatureModelData.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelID, modelRow] of creatureModelData.getAllRows()) {
		const textures = textureMap.get(modelID);
		if (textures !== undefined) {
			const fileDataID = modelRow.FileDataID;
			const entry = creatureTextures.get(fileDataID);

			if (entry !== undefined) {
				for (const texture of textures)
					entry.add(texture);
			} else {
				creatureTextures.set(fileDataID, new Set(textures));
			}
		}
	}

	log.write('Loaded textures for %d creatures', creatureTextures.size);

	// Checks if ChrModel.db2 is available -- if not we're not using Shadowlands.
	if (listfile.getByFilename('DBFilesClient/ChrModel.db2')) {
		chrCustomizationAvailable = true;
		const chrModel = new WDCReader('DBFilesClient/ChrModel.db2', DB_ChrModel);
		await chrModel.parse();
		for (const [chrModelID, chrModelRow] of chrModel.getAllRows()) {
			const displayRow = creatureDisplayInfo.getRow(chrModelRow.DisplayID);
			const modelRow = creatureModelData.getRow(displayRow.ModelID);
			fdidToChrModel.set(modelRow.FileDataID, chrModelID);
		}
	}

	if (chrCustomizationAvailable){
		const chrCustomization = new WDCReader('DBFilesClient/ChrCustomization.db2', DB_ChrCustomization);
		await chrCustomization.parse();

		// const chrCustomizationCategory = new WDCReader('DBFilesClient/ChrCustomizationCategory.db2', DB_ChrCustomizationCategory);
		// await chrCustomizationCategory.parse();

		const chrCustomizationOption = new WDCReader('DBFilesClient/ChrCustomizationOption.db2', DB_ChrCustomizationOption);
		await chrCustomizationOption.parse();

		const chrCustomizationChoice = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2', DB_ChrCustomizationChoice);
		await chrCustomizationChoice.parse();
	}
}

/**
 * Gets creature skins from a given file data ID.
 * @param {number} fileDataID 
 * @returns {string|undefined}
 */
const getCreatureSkinsByFileDataID = (fileDataID) => {
	return creatureTextures.get(fileDataID);
};

/**
 * Returns whether or not a given file data ID is a character model.
 * @param {number} fileDataID
 * @returns {boolean}
 */
const isFileDataIDCharacterModel = (fileDataID) => {
	return fdidToChrModel.has(fileDataID);
};

/**
 * Gets ChrModelID for a given file data ID.
 * @param {number} fileDataID
 * @returns {number}
 */
const getChrModelIDByFileDataID = (fileDataID) => {
	return fdidToChrModel.get(fileDataID);
};

/** 
 * Returns whether or not Character Customization is available.
 * @returns {boolean}
 */
const isCharacterCustomizationAvailable = () => {
	return chrCustomizationAvailable;
};

module.exports = { loadTables, getCreatureSkinsByFileDataID, isFileDataIDCharacterModel, getChrModelIDByFileDataID, isCharacterCustomizationAvailable};