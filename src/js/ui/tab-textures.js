/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const path = require('path');
const generics = require('../generics');
const constants = require('../constants');
const listfile = require('../casc/listfile');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const JSONWriter = require('../3D/writers/JSONWriter');
const FileWriter = require('../file-writer');

let selectedFileDataID = 0;

/**
 * Preview a texture by the given fileDataID.
 * @param {number} fileDataID 
 * @param {string} [texture]
 */
const previewTextureByID = async (fileDataID, texture = null) => {
	texture = texture ?? listfile.getByID(fileDataID);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const view = core.view;
		const file = await core.view.casc.getFile(fileDataID);

		const blp = new BLPFile(file);

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

const exportFiles = async (files, isLocal = false) => {
	const helper = new ExportHelper(files.length, 'texture');
	helper.start();

	const exportPaths = new FileWriter(constants.LAST_EXPORT, 'utf8');

	const format = core.view.config.exportTextureFormat;
	const overwriteFiles = isLocal || core.view.config.overwriteFiles;
	const exportMeta = core.view.config.exportBLPMeta;

	for (let fileEntry of files) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;
			
		let fileName;
		let fileDataID;
		if (typeof fileEntry === 'number') {
			fileDataID = fileEntry;
			fileName = listfile.getByID(fileDataID) ?? 'unknown/' + fileDataID + '.blp';
		} else {
			fileName = listfile.stripFileEntry(fileEntry);
			fileDataID = listfile.getByFilename(fileName);
		}
		
		try {
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
			if (format !== 'BLP')
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');	

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFile(fileDataID));

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await data.writeToFile(exportPath);
					exportPaths.writeLine('BLP:' + exportPath);
				} else {
					// Export as PNG.
					const blp = new BLPFile(data);
					await blp.saveToPNG(exportPath, core.view.config.exportChannelMask);
					exportPaths.writeLine('PNG:' + exportPath);

					if (exportMeta) {
						const json = new JSONWriter(ExportHelper.replaceExtension(exportPath, '.json'));
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
				previewTextureByID(fileDataID);
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

module.exports = { previewTextureByID };