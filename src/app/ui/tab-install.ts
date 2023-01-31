/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import State from '../state';
import Events from '../events';
import * as listfile from '../casc/listfile';
import * as log from '../log';
import ExportHelper from '../casc/export-helper';
import * as generics from '../generics';

let manifest: any = null;

const updateInstallListfile = () => {
	State.listfileInstall = manifest.files.filter((file) => {
		for (const tag of State.installTags) {
			if (tag.enabled && file.tags.includes(tag.label))
				return true;
		}

		return false;
	}).map(e => e.name + ' [' + e.tags.join(', ') + ']');
};

Events.once('screen-tab-install', async () => {
	State.setToast('progress', 'Retrieving installation manifest...', null, -1, false);
	manifest = await State.casc.getInstallManifest();

	State.installTags = manifest.tags.map(e => {
		return { label: e.name, enabled: true, mask: e.mask };
	});
	State.$watch('installTags', () => updateInstallListfile(), { deep: true, immediate: true });

	State.hideToast();
});

// Track when the user clicks to export selected install files.
Events.on('click-export-install', async () => {
	const userSelection = State.selectionInstall;
	if (userSelection.length === 0) {
		State.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(userSelection.length, 'file');
	helper.start();

	const overwriteFiles = State.config.overwriteFiles;
	for (let fileName of userSelection) {
		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;


		fileName = listfile.stripFileEntry(fileName);
		const file = manifest.files.find(e => e.name === fileName);
		const exportPath = ExportHelper.getExportPath(fileName);

		if (overwriteFiles || !await generics.fileExists(exportPath)) {
			try {
				const data = await State.casc.getFile(0, false, false, true, false, file.hash);
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