/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { watch } from 'vue';
import { state } from '../core';
import { setClipboard } from '../system';
import Events from '../events';
import Log from '../log';
import ExportHelper from '../casc/export-helper';
import { EncryptionError } from '../casc/blte-reader';
import util from 'node:util';
import { fileExists } from '../generics';
import Listfile from '../casc/listfile';

let selectedFile: string;

Events.once('casc:initialized', async () => {
	// Track selection changes on the text listbox and set first as active entry.
	watch(() => state.selectionText, async selection => {
		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (!state.isBusy && first && selectedFile !== first) {
			try {
				const file = await state.casc.getFileByName(first);
				state.textViewerSelectedText = file.readString(undefined, 'utf8');

				selectedFile = first;
			} catch (e) {
				if (e instanceof EncryptionError) {
					// Missing decryption key.
					state.setToast('error', util.format('The text file %s is encrypted with an unknown key (%s).', first, e.key), null, -1);
					Log.write('Failed to decrypt texture %s (%s)', first, e.key);
				} else {
					// Error reading/parsing text file.
					state.setToast('error', 'Unable to preview text file ' + first, { 'View Log': () => Log.openRuntimeLog() }, -1);
					Log.write('Failed to open CASC file: %s', e.message);
				}
			}
		}
	}, { deep: true });

	// Track when the user clicks to copy the open text file to clipboard.
	Events.on('click-copy-text', async () => {
		setClipboard(state.textViewerSelectedText);
		state.setToast('success', util.format('Copied contents of %s to the clipboard.', selectedFile), null, -1, true);
	});

	// Track when the user clicks to export selected text files.
	Events.on('click-export-text', async () => {
		const userSelection = state.selectionText;
		if (userSelection.length === 0) {
			state.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'file');
		helper.start();

		const overwriteFiles = state.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			fileName = Listfile.stripFileEntry(fileName);

			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await fileExists(exportPath)) {
					const data = await state.casc.getFileByName(fileName);
					await data.writeToFile(exportPath);
				} else {
					Log.write('Skipping text export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});
});