/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import * as log from '../../log';
import WDCReader from '../WDCReader';

const matResIDToFileDataID : Map<number, number> = new Map();
const fileDataIDs : Set<number> = new Set();

/**
 * Initialize texture file data ID from TextureFileData.db2
 */
export const initializeTextureFileData = async () : Promise<void> => {
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

		matResIDToFileDataID.set(textureFileDataRow.MaterialResourcesID, textureFileDataID);
	}
	log.write('Loaded texture mapping for %d materials', matResIDToFileDataID.size);
};

/**
 * Retrieve a texture file data ID by a material resource ID.
 * @param matResID - Material
 * @returns FileDataID if found, otherwise undefined
 */
export const getTextureFileDataID = (matResID: number) : number | undefined => {
	return matResIDToFileDataID.get(matResID);
};

/**
 * Retrieve a list of all file data IDs cached from TextureFileData.db2
 * NOTE: This is reset once called by the listfile module; adjust if needed elsewhere.
 * @returns List of all file data IDs cached from TextureFileData.db2
 */
export const getFileDataIDs = () : Set<number> => {
	return fileDataIDs;
};