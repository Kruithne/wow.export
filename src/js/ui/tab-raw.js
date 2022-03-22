/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const listfile = require('../casc/listfile');

let isDirty = true;

// When the screen is first accessed, compute all files.
core.events.on('screen-tab-raw', async () => {
	if (isDirty) {
		isDirty = false;

		if (core.view.config.enableUnknownFiles) {
			core.setToast('progress', 'Scanning game client for all files...');
			await generics.redraw();

			const rootEntries = core.view.casc.rootEntries;
			core.view.listfileRaw = listfile.formatEntries([...rootEntries.keys()]);
			core.setToast('success', util.format('Found %d files in the game client', core.view.listfileRaw.length));
		} else {
			core.setToast('progress', 'Scanning game client for all known files...');
			await generics.redraw();
			
			core.view.listfileRaw = listfile.getFullListfile();
			core.setToast('success', util.format('Found %d known files in the game client', core.view.listfileRaw.length));
		}
	}
});

core.events.on('listfile-needs-updating', () => {
	isDirty = true;
});

// Track when the user clicks to export selected raw files.
core.events.on('click-export-raw', async () => {
	const userSelection = core.view.selectionRaw;
	if (userSelection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(userSelection.length, 'file');
	helper.start();
	
	const overwriteFiles = core.view.config.overwriteFiles;
	for (let fileName of userSelection) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		fileName = listfile.stripFileEntry(fileName);
		const exportPath = ExportHelper.getExportPath(fileName);

		if (overwriteFiles || !await generics.fileExists(exportPath)) {
			try {
				const data = await core.view.casc.getFileByName(fileName);
				await data.writeToFile(exportPath);

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		} else {
			helper.mark(fileName, true);
			log.write('Skipping file export %s (file exists, overwrite disabled)', exportPath);
		}
	}

	helper.finish();
});