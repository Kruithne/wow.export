/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import * as core from '../core';
import * as log from '../log';
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import * as generics from '../generics';
import * as listfile from '../casc/listfile';
import BLPImage from '../casc/blp';
import BufferWrapper from '../buffer';
import ExportHelper from '../casc/export-helper';
import { EncryptionError } from '../casc/blte-reader';
import JSONWriter from '../3D/writers/JSONWriter';
import FileWriter from '../file-writer';

let selectedFileDataID = 0;

/**
 * Preview a texture by the given fileDataID.
 * @param fileDataID
 * @param texture
 */
export const previewTextureByID = async (fileDataID: number, texture: string|null = null) => {
	texture = texture ?? listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const view = core.view;
		const file = await core.view.casc.getFile(fileDataID);

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
		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			// Error reading/parsing texture.
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}

	core.view.isBusy--;
};

/**
 * Retrieve the fileDataID and fileName for a given fileDataID or fileName.
 * @param input
 * @returns
 */
const getFileInfoPair = (input: number | string): object => {
	let fileName: string;
	let fileDataID: number;

	if (typeof input === 'number') {
		fileDataID = input;
		fileName = listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID, '.blp');
	} else {
		fileName = listfile.stripFileEntry(input);
		fileDataID = listfile.getByFilename(fileName) as number;
	}

	return { fileName, fileDataID };
};

const exportFiles = async (files, isLocal = false) => {
	const format = core.view.config.exportTextureFormat;

	if (format === 'CLIPBOARD') {
		const { fileName, fileDataID }: any = getFileInfoPair(files[0]);

		const data = isLocal ? new BufferWrapper(await fs.promises.readFile(fileName)) : await core.view.casc.getFile(fileDataID);
		const blp = new BLPImage(data);
		const png = blp.toPNG(core.view.config.exportChannelMask);

		const clipboard = nw.Clipboard.get();
		clipboard.set(png.toString('base64'), 'png', true);

		log.write('Copied texture to clipboard (%s)', fileName);
		core.setToast('success', util.format('Selected texture %s has been copied to the clipboard', fileName), null, -1, true);

		return;
	}

	const helper = new ExportHelper(files.length, 'texture');
	helper.start();

	const exportPaths = new FileWriter(core.view.lastExportPath, 'utf8');

	const overwriteFiles = isLocal || core.view.config.overwriteFiles;
	const exportMeta = core.view.config.exportBLPMeta;

	for (const fileEntry of files) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		const filePair: any = getFileInfoPair(fileEntry);
		const fileName = filePair.fileName;
		const fileDataID = filePair.fileDataID;

		try {
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
			if (format !== 'BLP')
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				const data = isLocal ? new BufferWrapper(await fs.promises.readFile(fileName)) : await core.view.casc.getFile(fileDataID);

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await data.writeToFile(exportPath);
					exportPaths.writeLine('BLP:' + exportPath);
				} else {
					// Export as PNG.
					const blp = new BLPImage(data);
					await blp.saveToPNG(exportPath, core.view.config.exportChannelMask);
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
				log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			}

			helper.mark(fileName, true);
		} catch (e) {
			helper.mark(fileName, false, e.message);
		}
	}

	await exportPaths.close();
	helper.finish();
};

// Register a drop handler for BLP files.
core.registerDropHandler({
	ext: ['.blp'],
	prompt: count => util.format('Export %d textures as %s', count, core.view.config.exportTextureFormat),
	process: files => exportFiles(files, true)
});

core.registerLoadFunc(async () => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	core.view.$watch('config.exportTextureAlpha', () => {
		if (!core.view.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.view.$watch('selectionTextures', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (first && !core.view.isBusy) {
			const fileDataID = listfile.getByFilename(first);
			if (selectedFileDataID !== fileDataID)
				previewTextureByID(fileDataID as number);
		}
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		const userSelection = core.view.selectionTextures;
		if (userSelection.length > 0) {
			// In most scenarios, we have a user selection to export.
			await exportFiles(userSelection);
		} else if (selectedFileDataID > 0) {
			// Less common, but we might have a direct preview that isn't selected.
			await exportFiles([selectedFileDataID]);
		} else {
			// Nothing to be exported, show the user an error.
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		}
	});

	// Track when the user changes the colour channel mask.
	core.view.$watch('config.exportChannelMask', () => {
		if (!core.view.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});
});