/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import * as log from '../../log';
import WDCReader from '../WDCReader';

import { getModelFileDataID } from './DBModelFileData';
import { getTextureFileDataID } from './DBTextureFileData';

const itemDisplays : Map<number, object> = new Map();

/**
 * Initialize item displays from ItemDisplayInfo.db2
 */
export const initializeItemDisplays = async () : Promise<void> => {
	log.write('Loading item textures...');
	const itemDisplayInfo = new WDCReader('DBFilesClient/ItemDisplayInfo.db2');
	await itemDisplayInfo.parse();

	if (!itemDisplayInfo.schema.has('ModelResourcesID') || !itemDisplayInfo.schema.has('ModelMaterialResourcesID')) {
		log.write('Unable to load item textures, ItemDisplayInfo is missing required fields.');
		core.setToast('error', 'Item textures failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
			'Clear Cache': () => core.events.emit('click-cache-clear'),
			'Not Now': () => false
		}, -1, false);
		return;
	}

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [itemDisplayInfoID, itemDisplayInfoRow] of itemDisplayInfo.getAllRows()) {
		const modelResIDs = (itemDisplayInfoRow.ModelResourcesID as number[]).filter(e => e > 0);
		if (modelResIDs.length == 0)
			continue;

		const matResIDs = (itemDisplayInfoRow.ModelMaterialResourcesID as number[]).filter(e => e > 0);
		if (matResIDs.length == 0)
			continue;

		const modelFileDataIDs = getModelFileDataID(modelResIDs[0]);
		const textureFileDataID = getTextureFileDataID(matResIDs[0]);

		if (modelFileDataIDs !== undefined && textureFileDataID !== undefined) {
			for (const modelFileDataID of modelFileDataIDs) {
				const display = { ID: itemDisplayInfoID, textures: [textureFileDataID]};

				if (itemDisplays.has(modelFileDataID))
					itemDisplays.get(modelFileDataID).push(display);
				else
					itemDisplays.set(modelFileDataID, [display]);
			}
		}
	}

	log.write('Loaded textures for %d items', itemDisplays.size);
};

/**
 * Gets item skins from a given file data ID.
 * @param fileDataID
 * @returns Display object if found, otherwise undefined
 */
export const getItemDisplaysByFileDataID = (fileDataID: number) : object|undefined => {
	return itemDisplays.get(fileDataID);
};