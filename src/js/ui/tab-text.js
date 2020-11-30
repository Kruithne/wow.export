/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const generics = require('../generics');
const util = require('util');

let selectedFile = null;

core.registerLoadFunc(async () => {
	// Track selection changes on the text listbox and set first as active entry.
	core.view.$watch('selectionText', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first) {
			try {
				const file = await core.view.casc.getFileByName(first);
				core.view.textViewerSelectedText = file.readString(undefined, 'utf8');

				selectedFile = first;
			} catch (e) {
				if (e instanceof EncryptionError) {
					// Missing decryption key.
					core.setToast('error', util.format('The text file %s is encrypted with an unknown key (%s).', first, e.key));
					log.write('Failed to decrypt texture %s (%s)', first, e.key);
				} else {
					// Error reading/parsing text file.
					core.setToast('error', 'Unable to preview text file ' + first, { 'View Log': () => log.openRuntimeLog() });
					log.write('Failed to open CASC file: %s', e.message);
				}
			}
		}
	});

	// Track when the user clicks to export selected text files.
	core.events.on('click-export-text', async () => {
		const userSelection = core.view.selectionText;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'files');
		helper.start();
		
		const overwriteFiles = core.view.config.overwriteFiles;
		for (const fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;
				
			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					const data = await core.view.casc.getFileByName(fileName);
					await data.writeToFile(exportPath);
				} else {
					log.write('Skipping text export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});
});