/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import log from '../../log';
import WDCReader from '../WDCReader';

const creatureDisplays = new Map();

/**
 * Initialize creature data.
 * @param creatureDisplayInfo - CreatureDisplayInfo reader
 * @param creatureModelData - CreatureModelData reader
 */
export const initializeCreatureData = async (creatureDisplayInfo: WDCReader, creatureModelData: WDCReader) : Promise<void> => {
	log.write('Loading creature textures...');

	const creatureGeosetMap = new Map();

	const creatureDisplayInfoGeosetData = new WDCReader('DBFilesClient/CreatureDisplayInfoGeosetData.db2');
	await creatureDisplayInfoGeosetData.parse();

	if (!creatureDisplayInfoGeosetData.schema.has('CreatureDisplayInfoID') || !creatureDisplayInfoGeosetData.schema.has('GeosetValue')) {
		log.write('Unable to load creature textures, CreatureDisplayInfoGeosetData is missing required fields.');
		core.setToast('error', 'Creature textures failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
			'Clear Cache': () => core.events.emit('click-cache-clear'),
			'Not Now': () => false
		}, -1, false);
		return;
	}

	// CreatureDisplayInfoID => Array of geosets to enable which should only be used if CreatureModelData.CreatureDisplayInfoGeosetData != 0
	for (const geosetRow of creatureDisplayInfoGeosetData.getAllRows().values()) {
		if (!creatureGeosetMap.has(geosetRow.CreatureDisplayInfoID))
			creatureGeosetMap.set(geosetRow.CreatureDisplayInfoID, []);

		creatureGeosetMap.get(geosetRow.CreatureDisplayInfoID).push(((geosetRow.GeosetIndex as number) + 1) * 100 + (geosetRow.GeosetValue as number));
	}

	const creatureDisplayInfoMap = new Map();
	const modelIDToDisplayInfoMap = new Map();

	// Map all available texture fileDataIDs to model IDs.
	for (const [displayID, displayRow] of creatureDisplayInfo.getAllRows()) {
		creatureDisplayInfoMap.set(displayID, { ID: displayID, modelID: displayRow.ModelID, textures: (displayRow.TextureVariationFileDataID as number[]).filter(e => e > 0)});

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
 * @param fileDataID
 * @returns String when found or undefined if not
 */
export const getCreatureDisplaysByFileDataID = (fileDataID: number): string | undefined => {
	return creatureDisplays.get(fileDataID);
};