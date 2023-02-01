/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import State from '../../state';
import Events from '../../events';
import Log from '../../log';
import WDCReader from '../WDCReader';

import { getModelFileDataID } from './DBModelFileData';
import { getTextureFileDataID } from './DBTextureFileData';

import ItemDisplayInfo from '../types/ItemDisplayInfo';

export type ItemDisplayInfoEntry = {
	ID: number,
	textures: Array<number>
};

const itemDisplays: Map<number, Array<ItemDisplayInfoEntry>> = new Map();

/**
 * Initialize item displays from ItemDisplayInfo.db2
 */
export async function initializeItemDisplays(): Promise<void> {
	Log.write('Loading item textures...');
	const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.db2');
	await itemDisplayInfo.parse();

	if (!itemDisplayInfo.schema.has('ModelResourcesID') || !itemDisplayInfo.schema.has('ModelMaterialResourcesID')) {
		Log.write('Unable to load item textures, ItemDisplayInfo is missing required fields.');
		State.setToast('error', 'Item textures failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
			'Clear Cache': () => Events.emit('click-cache-clear'),
			'Not Now': () => false
		}, -1, false);
		return;
	}

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [itemDisplayInfoID, itemDisplayInfoRow] of itemDisplayInfo.getAllRows() as Map<number, ItemDisplayInfo>) {
		const modelResIDs = (itemDisplayInfoRow.ModelResourcesID as Array<number>).filter(e => e > 0);
		if (modelResIDs.length == 0)
			continue;

		const matResIDs = (itemDisplayInfoRow.ModelMaterialResourcesID as Array<number>).filter(e => e > 0);
		if (matResIDs.length == 0)
			continue;

		const modelFileDataIDs = getModelFileDataID(modelResIDs[0]);
		const textureFileDataID = getTextureFileDataID(matResIDs[0]);

		if (modelFileDataIDs !== undefined && textureFileDataID !== undefined) {
			for (const modelFileDataID of modelFileDataIDs) {
				const display = { ID: itemDisplayInfoID, textures: [textureFileDataID] };

				if (itemDisplays.has(modelFileDataID))
					itemDisplays.get(modelFileDataID).push(display);
				else
					itemDisplays.set(modelFileDataID, [display]);
			}
		}
	}

	Log.write('Loaded textures for %d items', itemDisplays.size);
}

/**
 * Gets item skins from a given file data ID.
 * @param fileDataID - File data ID to get item skins for
 * @returns Item skins for the given file data ID or undefined if none exist.
 */
export function getItemDisplaysByFileDataID(fileDataID: number): Array<ItemDisplayInfoEntry> | undefined {
	return itemDisplays.get(fileDataID);
}