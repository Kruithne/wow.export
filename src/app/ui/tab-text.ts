/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import State from '../state';
import Events from '../events';
import Log from '../log';
import ExportHelper from '../casc/export-helper';
import { EncryptionError } from '../casc/blte-reader';
import util from 'node:util';
import { fileExists } from '../generics';
import Listfile from '../casc/listfile';

let selectedFile: string;

State.state.registerLoadFunc(async () => {
	// Track selection changes on the text listbox and set first as active entry.
	State.state.$watch('selectionText', async selection => {
		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (!State.state.isBusy && first && selectedFile !== first) {
			try {
				const file = await State.state.casc.getFileByName(first);
				State.state.textViewerSelectedText = file.readString(undefined, 'utf8');

				selectedFile = first;
			} catch (e) {
				if (e instanceof EncryptionError) {
					// Missing decryption key.
					State.state.setToast('error', util.format('The text file %s is encrypted with an unknown key (%s).', first, e.key), null, -1);
					Log.write('Failed to decrypt texture %s (%s)', first, e.key);
				} else {
					// Error reading/parsing text file.
					State.state.setToast('error', 'Unable to preview text file ' + first, { 'View Log': () => Log.openRuntimeLog() }, -1);
					Log.write('Failed to open CASC file: %s', e.message);
				}
			}
		}
	});

	// Track when the user clicks to copy the open text file to clipboard.
	Events.on('click-copy-text', async () => {
		const clipboard = nw.Clipboard.get();
		clipboard.set(State.state.textViewerSelectedText, 'text');
		State.state.setToast('success', util.format('Copied contents of %s to the clipboard.', selectedFile), null, -1, true);
	});

	// Track when the user clicks to export selected text files.
	Events.on('click-export-text', async () => {
		const userSelection = State.state.selectionText;
		if (userSelection.length === 0) {
			State.state.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'file');
		helper.start();

		const overwriteFiles = State.state.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			fileName = Listfile.stripFileEntry(fileName);

			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await fileExists(exportPath)) {
					const data = await State.state.casc.getFileByName(fileName);
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