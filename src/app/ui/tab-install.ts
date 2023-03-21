/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { watch } from 'vue';
import { state, setToast, hideToast } from '../core';
import Events from '../events';
import Listfile from '../casc/listfile';
import Log from '../log';
import ExportHelper from '../casc/export-helper';
import { fileExists } from '../generics';

import InstallManifest, { InstallFile } from '../casc/install-manifest';

let manifest: InstallManifest;

function updateInstallListfile(): void {
	state.listfileInstall = manifest.files.filter((file) => {
		for (const tag of state.installTags) {
			if (tag.enabled && file.tags.includes(tag.label))
				return true;
		}

		return false;
	}).map(e => e.name + ' [' + e.tags.join(', ') + ']');
}

Events.once('screen:tab-install', async () => {
	setToast('progress', 'Retrieving installation manifest...', null, -1, false);
	manifest = await state.casc.getInstallManifest();

	state.installTags = manifest.tags.map(e => {
		return { label: e.name, enabled: true, mask: e.mask };
	});

	watch(() => state.installTags, () => updateInstallListfile(), { deep: true, immediate: true });

	hideToast();
});

// Track when the user clicks to export selected install files.
Events.on('click-export-install', async () => {
	const userSelection = state.selectionInstall;
	if (userSelection.length === 0) {
		setToast('info', 'You didn\'t select any files to export; you should do that first.');
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
		const file = manifest.files.find(e => e.name === fileName) as InstallFile;
		const exportPath = ExportHelper.getExportPath(fileName);

		if (overwriteFiles || !await fileExists(exportPath)) {
			try {
				const data = await state.casc.getFile(0, false, false, true, false, file.hash);
				await data.writeToFile(exportPath);

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		} else {
			helper.mark(fileName, true);
			Log.write('Skipping file export %s (file exists, overwrite disabled)', exportPath);
		}
	}

	helper.finish();
});