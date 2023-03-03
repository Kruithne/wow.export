/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

import { fileExists } from '../generics';
import { EncryptionError } from '../casc/blte-reader';

import { state } from '../core';
import { setClipboard } from '../system';
import Events from '../events';
import Log from '../log';
import Listfile from '../casc/listfile';
import BLPImage from '../casc/blp';
import BufferWrapper from '../buffer';
import ExportHelper from '../casc/export-helper';
import JSONWriter from '../3D/writers/JSONWriter';
import FileWriter from '../file-writer';

type FileInfoPair = {
	fileDataID: number;
	fileName: string;
};

let selectedFileDataID = 0;

/**
 * Preview a texture by the given fileDataID.
 * @param fileDataID
 * @param texture
 */
export async function previewTextureByID(fileDataID: number, texture: string | null = null): Promise<void> {
	texture = texture ?? Listfile.getByID(fileDataID) ?? Listfile.formatUnknownFile(fileDataID);

	state.isBusy++;
	state.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	Log.write('Previewing texture file %s', texture);

	try {
		const view = state;
		const file = await state.casc.getFile(fileDataID);

		const blp = new BLPImage(file);

		view.texturePreviewURL = blp.getDataURL(view.config.exportChannelMask);
		view.texturePreviewWidth = blp.width;
		view.texturePreviewHeight = blp.height;

		let info = '';

		switch (blp.encoding) {
			case 1:
				info = 'Palette';
				break;
			case 2:
				info = 'Compressed ' + (blp.alphaDepth > 1 ? (blp.alphaEncoding === 7 ? 'DXT5' : 'DXT3') : 'DXT1');
				break;
			case 3:
				info = 'ARGB';
				break;
			default:
				info = 'Unsupported [' + blp.encoding + ']';
		}

		view.texturePreviewInfo = util.format('%s %d x %d (%s)', path.basename(texture), blp.width, blp.height, info);

		selectedFileDataID = fileDataID;
		state.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			state.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
			Log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			// Error reading/parsing texture.
			state.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => Log.openRuntimeLog() }, -1);
			Log.write('Failed to open CASC file: %s', e.message);
		}
	}

	state.isBusy--;
}

/**
 * Retrieve the fileDataID and fileName for a given fileDataID or fileName.
 * @param input - The fileDataID or fileName.
 * @returns The fileDataID and fileName.
 */
const getFileInfoPair = (input: number | string): FileInfoPair => {
	let fileName: string;
	let fileDataID: number;

	if (typeof input === 'number') {
		fileDataID = input;
		fileName = Listfile.getByID(fileDataID) ?? Listfile.formatUnknownFile(fileDataID, '.blp');
	} else {
		fileName = Listfile.stripFileEntry(input);
		fileDataID = Listfile.getByFilename(fileName) as number;
	}

	return { fileName, fileDataID };
};

/**
 * Export textures.
 * @param files - The files to export.
 * @param isLocal - Whether the files are local or from CASC.
 */
async function exportFiles(files: Array<string | number>, isLocal = false): Promise<void> {
	const format = state.config.exportTextureFormat;

	if (format === 'CLIPBOARD') {
		const { fileName, fileDataID } = getFileInfoPair(files[0]);

		let data: BufferWrapper;
		if (isLocal)
			data = new BufferWrapper(await fs.promises.readFile(fileName));

		else
			data = await state.casc.getFile(fileDataID);

		const blp = new BLPImage(data);
		const png = blp.toPNG(state.config.exportChannelMask);

		setClipboard(png.readString(undefined, 'base64'), 'png', true);

		Log.write('Copied texture to clipboard (%s)', fileName);
		state.setToast('success', util.format('Selected texture %s has been copied to the clipboard', fileName), null, -1, true);

		return;
	}

	const helper = new ExportHelper(files.length, 'texture');
	helper.start();

	const exportPaths = new FileWriter(state.lastExportPath, 'utf8');

	const overwriteFiles = isLocal || state.config.overwriteFiles;
	const exportMeta = state.config.exportBLPMeta;

	for (const fileEntry of files) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		const filePair = getFileInfoPair(fileEntry);
		const fileName = filePair.fileName;
		const fileDataID = filePair.fileDataID;

		try {
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
			if (format !== 'BLP')
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');

			if (overwriteFiles || !await fileExists(exportPath)) {
				const data = isLocal ? new BufferWrapper(await fs.promises.readFile(fileName)) : await state.casc.getFile(fileDataID);

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await data.writeToFile(exportPath);
					exportPaths.writeLine('BLP:' + exportPath);
				} else {
					// Export as PNG.
					const blp = new BLPImage(data);
					await blp.toPNG(state.config.exportChannelMask).writeToFile(exportPath);
					exportPaths.writeLine('PNG:' + exportPath);

					if (exportMeta) {
						const jsonOut = ExportHelper.replaceExtension(exportPath, '.json');
						const json = new JSONWriter(jsonOut);
						json.addProperty('encoding', blp.encoding);
						json.addProperty('alphaDepth', blp.alphaDepth);
						json.addProperty('alphaEncoding', blp.alphaEncoding);
						json.addProperty('mipmaps', blp.containsMipmaps);
						json.addProperty('width', blp.width);
						json.addProperty('height', blp.height);
						json.addProperty('mipmapCount', blp.mapCount);
						json.addProperty('mipmapSizes', blp.mapSizes);

						await json.write(overwriteFiles);
					}
				}
			} else {
				Log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			}

			helper.mark(fileName, true);
		} catch (e) {
			helper.mark(fileName, false, e.message);
		}
	}

	await exportPaths.close();
	helper.finish();
}

Events.once('casc:initialized', (): void => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	state.$watch('config.exportTextureAlpha', () => {
		if (!state.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});

	// Track selection changes on the texture listbox and preview first texture.
	state.$watch('selectionTextures', async (selection: Array<string>) => {
		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (first && !state.isBusy) {
			const fileDataID = Listfile.getByFilename(first);
			if (selectedFileDataID !== fileDataID)
				previewTextureByID(fileDataID as number);
		}
	}, { deep: true });

	// Track when the user clicks to export selected textures.
	Events.on('click-export-texture', async () => {
		const userSelection = state.selectionTextures;
		if (userSelection.length > 0) {
			// In most scenarios, we have a user selection to export.
			await exportFiles(userSelection);
		} else if (selectedFileDataID > 0) {
			// Less common, but we might have a direct preview that isn't selected.
			await exportFiles([selectedFileDataID]);
		} else {
			// Nothing to be exported, show the user an error.
			state.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		}
	});

	// Track when the user changes the colour channel mask.
	state.$watch('config.exportChannelMask', () => {
		if (!state.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});
});

export default {
	previewTextureByID
};