/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const BLTEIntegrityError = require('../casc/blte-reader');
const generics = require('../generics');

core.registerLoadFunc(async () => {
	// Track when the user clicks to export selected sound files.
	core.events.on('click-export-video', async () => {
		const userSelection = core.view.selectionVideos;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'videos');
		helper.start();
		
		const overwriteFiles = core.view.config.overwriteFiles;
		for (const fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;
				
			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					let data;
					try {
						data = await core.view.casc.getFileByName(fileName);
					} catch (e) {
						// Corrupted file, often caused by users cancelling a cinematic while it is streaming.
						if (e instanceof BLTEIntegrityError)
							data = await core.view.casc.getFileByName(fileName, false, false, true, true);
						else
							throw e;
					}
					
					await data.writeToFile(exportPath);
				} else {
					log.write('Skipping video export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});
});