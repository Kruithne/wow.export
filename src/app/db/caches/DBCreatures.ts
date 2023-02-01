/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import State from '../../state';
import Events from '../../events';
import Log from '../../log';
import WDCReader from '../WDCReader';

import CreatureModelData from '../types/CreatureModelData';
import CreatureDisplayInfo from '../types/CreatureDisplayInfo';

export type CreatureDisplayInfoEntry = {
	ID: number,
	modelID: number,
	textures: Array<number>,
	extraGeosets?: Array<number>
};

const creatureDisplays = new Map<number, Array<CreatureDisplayInfoEntry>>();

/**
 * Initialize creature data.
 * @param creatureDisplayInfo - CreatureDisplayInfo reader
 * @param creatureModelData - CreatureModelData reader
 */
export async function initializeCreatureData(creatureDisplayInfo: WDCReader, creatureModelData: WDCReader): Promise<void> {
	Log.write('Loading creature textures...');

	const creatureGeosetMap = new Map();

	const creatureDisplayInfoGeosetData = new WDCReader('DBFilesClient/CreatureDisplayInfoGeosetData.db2');
	await creatureDisplayInfoGeosetData.parse();

	if (!creatureDisplayInfoGeosetData.schema.has('CreatureDisplayInfoID') || !creatureDisplayInfoGeosetData.schema.has('GeosetValue')) {
		Log.write('Unable to load creature textures, CreatureDisplayInfoGeosetData is missing required fields.');
		State.setToast('error', 'Creature textures failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
			'Clear Cache': () => Events.emit('click-cache-clear'),
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

	const creatureDisplayInfoMap = new Map<number, CreatureDisplayInfoEntry>();
	const modelIDToDisplayInfoMap = new Map();

	// Map all available texture fileDataIDs to model IDs.
	for (const [displayID, displayRow] of creatureDisplayInfo.getAllRows() as Map<number, CreatureDisplayInfo>) {
		creatureDisplayInfoMap.set(displayID, {
			ID: displayID,
			modelID: displayRow.ModelID,
			textures: displayRow.TextureVariationFileDataID.filter(e => e > 0)
		});

		if (modelIDToDisplayInfoMap.has(displayRow.ModelID))
			modelIDToDisplayInfoMap.get(displayRow.ModelID).push(displayID);
		else
			modelIDToDisplayInfoMap.set(displayRow.ModelID, [displayID]);
	}

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelID, modelRow] of creatureModelData.getAllRows() as Map<number, CreatureModelData>) {
		if (modelIDToDisplayInfoMap.has(modelID)) {
			const fileDataID = modelRow.FileDataID;
			const displayIDs = modelIDToDisplayInfoMap.get(modelID);
			const modelIDHasExtraGeosets = modelRow.CreatureGeosetDataID > 0;

			for (const displayID of displayIDs) {
				const display = creatureDisplayInfoMap.get(displayID);

				if (modelIDHasExtraGeosets) {
					display.extraGeosets = Array<number>();
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

	Log.write('Loaded textures for %d creatures', creatureDisplays.size);
}

/**
 * Gets creature skins from a given file data ID.
 * @param fileDataID - File data ID
 * @returns Array of creature skins or undefined if no skins were found.
 */
export function getCreatureDisplaysByFileDataID(fileDataID: number): Array<CreatureDisplayInfoEntry> | undefined {
	return creatureDisplays.get(fileDataID);
}