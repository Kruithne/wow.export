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
const constants = require('../constants');
const listfile = require('../casc/listfile');

let isDirty = true;

const computeRawFiles = async () => {
	if (isDirty) {
		isDirty = false;

		if (core.view.config.enableUnknownFiles) {
			core.setToast('progress', 'Scanning game client for all files...');
			await generics.redraw();

			const rootEntries = core.view.casc.getValidRootEntries();
			core.view.listfileRaw = listfile.formatEntries(rootEntries);
			core.setToast('success', util.format('Found %d files in the game client', core.view.listfileRaw.length));
		} else {
			core.setToast('progress', 'Scanning game client for all known files...');
			await generics.redraw();

			core.view.listfileRaw = listfile.getFullListfile();
			core.setToast('success', util.format('Found %d known files in the game client', core.view.listfileRaw.length));
		}
	}
};

core.registerLoadFunc(async () => {
	core.events.on('screen-tab-raw', () => computeRawFiles());
	core.events.on('listfile-needs-updating', () => { isDirty = true; });
	core.view.$watch('config.cascLocale', () => { isDirty = true; });
});

// Track when the user clicks to auto-detect raw files.
core.events.on('click-detect-raw', async () => {
	const userSelection = core.view.selectionRaw;
	if (userSelection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to detect; you should do that first.');
		return;
	}
	
	const filteredSelection = [];
	for (let fileName of userSelection) {
		fileName = listfile.stripFileEntry(fileName);
		const match = fileName.match(/^unknown\/(\d+)(\.[a-zA-Z_]+)$/);

		if (match)
			filteredSelection.push(parseInt(match[1]));
	}

	
	if (filteredSelection.length === 0) {
		core.setToast('info', 'You haven\'t selected any unknown files to identify.');
		return;
	}

	core.view.isBusy++;

	const extensionMap = new Map();
	let currentIndex = 1;

	for (const fileDataID of filteredSelection) {
		core.setToast('progress', util.format('Identifying file %d (%d / %d)', fileDataID, currentIndex++, filteredSelection.length))

		try {
			const data = await core.view.casc.getFile(fileDataID);
			for (const check of constants.FILE_IDENTIFIERS) {
				if (data.startsWith(check.match)) {
					extensionMap.set(fileDataID, check.ext);
					log.write('Successfully identified file %d as %s', fileDataID, check.ext);
					break;
				}
			}
		} catch (e) {
			log.write('Failed to identify file %d due to CASC error', fileDataID);
		}
	}

	if (extensionMap.size > 0) {
		listfile.ingestIdentifiedFiles(extensionMap);
		await computeRawFiles();

		if (extensionMap.size === 1) {
			const [fileDataID, ext] = extensionMap.entries().next().value;
			core.setToast('success', util.format('%d has been identified as a %s file', fileDataID, ext));
		} else {
			core.setToast('success', util.format('Successfully identified %d files', extensionMap.size));
		}

		core.setToast('success', util.format('%d of the %d selected files have been identified and added to relevant file lists', extensionMap.size, filteredSelection.length));
	} else {
		core.setToast('info', 'Unable to identify any of the selected files.');
	}

	core.view.isBusy--;
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
				const data = await core.view.casc.getFileByName(fileName, true);
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