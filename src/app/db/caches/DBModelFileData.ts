/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import * as log from '../../log';
import WDCReader from '../WDCReader';

const modelResIDToFileDataID: Map<number, Array<number>> = new Map();
const fileDataIDs: Set<number> = new Set();

/**
 * Initialize model file data from ModelFileData.db2
 */
export async function initializeModelFileData(): Promise<void> {
	log.write('Loading model mapping...');
	const modelFileData = new WDCReader('DBFilesClient/ModelFileData.db2');
	await modelFileData.parse();

	// Using the texture mapping, map all model fileDataIDs to used textures.
	for (const [modelFileDataID, modelFileDataRow] of modelFileData.getAllRows()) {
		// Keep a list of all FIDs for listfile unknowns.
		fileDataIDs.add(modelFileDataID);

		const modelResourcesID = modelFileDataRow.ModelResourcesID as number;
		if (modelResIDToFileDataID.has(modelResourcesID))
			modelResIDToFileDataID.get(modelResourcesID).push(modelFileDataID);
		else
			modelResIDToFileDataID.set(modelResourcesID, [modelFileDataID]);
	}
	log.write('Loaded model mapping for %d models', modelResIDToFileDataID.size);
}

/**
 * Retrieve a model file data ID.
 * @param modelResID - ModelResourceID
 * @returns FileDataIDs if found, otherwise undefined
 */
export function getModelFileDataID(modelResID: number): Array<number> | undefined {
	return modelResIDToFileDataID.get(modelResID);
}

/**
 * Retrieve a list of all file data IDs cached from ModelFileData.db2
 * NOTE: This is reset once called by the listfile module; adjust if needed elsewhere.
 * @returns List of all file data IDs cached from ModelFileData.db2
 */
export function getFileDataIDs(): Set<number> {
	return fileDataIDs;
}
