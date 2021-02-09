/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const generics = require('../generics');
const constants = require('../constants');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const FileWriter = require('../file-writer');

let selectedFile = null;

const previewTexture = async (texture) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {			
		const file = await core.view.casc.getFileByName(texture);
		const blp = new BLPFile(file);

		const view = core.view;
		view.texturePreviewURL = blp.getDataURL(view.config.exportTextureAlpha);
		view.texturePreviewWidth = blp.width;
		view.texturePreviewHeight = blp.height;

		selectedFile = texture;
		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key));
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			// Error reading/parsing texture.
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() });
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

	for (const fileName of files) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;
			
		try {
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
			if (format !== 'BLP')
				exportPath = ExportHelper.replaceExtension(exportPath, '.png');

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFileByName(fileName));

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await data.writeToFile(exportPath);
					exportPaths.writeLine('BLP:' + exportPath);
				} else {
					// Export as PNG.
					const blp = new BLPFile(data);
					await blp.saveToPNG(exportPath, core.view.config.exportTextureAlpha);
					exportPaths.writeLine('PNG:' + exportPath);
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
		if (!core.view.isBusy && selectedFile !== null)
			previewTexture(selectedFile);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.view.$watch('selectionTextures', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first)
			previewTexture(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		const userSelection = core.view.selectionTextures;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection);
	});
});