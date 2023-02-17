/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import State from '../state';
import Events from '../events';
import Log from '../log';
import ExportHelper from '../casc/export-helper';
import { BLTEIntegrityError } from '../casc/blte-reader';
import { fileExists } from '../generics';
import Listfile from '../casc/listfile';

Events.once('casc-ready', async () => {
	// Track when the user clicks to export selected sound files.
	Events.on('click-export-video', async () => {
		const userSelection = State.state.selectionVideos;
		if (userSelection.length === 0) {
			State.state.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'video');
		helper.start();

		const overwriteFiles = State.state.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			fileName = Listfile.stripFileEntry(fileName);
			const exportPath = ExportHelper.getExportPath(fileName);
			let isCorrupted = false;

			if (overwriteFiles || !await fileExists(exportPath)) {
				try {
					const data = await State.state.casc.getFileByName(fileName);
					await data.writeToFile(exportPath);

					helper.mark(fileName, true);
				} catch (e) {
					// Corrupted file, often caused by users cancelling a cinematic while it is streaming.
					if (e instanceof BLTEIntegrityError)
						isCorrupted = true;
					else
						helper.mark(fileName, false, e.message);
				}

				if (isCorrupted) {
					try {
						Log.write('Local cinematic file is corrupted, forcing fallback.');

						// In the event of a corrupted cinematic, try again with forced fallback.
						const data = await State.state.casc.getFileByName(fileName, false, false, true, true);
						await data.writeToFile(exportPath);

						helper.mark(fileName, true);
					} catch (e) {
						helper.mark(fileName, false, e.message);
					}
				}
			} else {
				helper.mark(fileName, true);
				Log.write('Skipping video export %s (file exists, overwrite disabled)', exportPath);
			}
		}

		helper.finish();
	});
});