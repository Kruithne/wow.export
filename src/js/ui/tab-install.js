/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const listfile = require('../casc/listfile');

let manifest = null;

const updateInstallListfile = () => {
	core.view.listfileInstall = manifest.files.filter((file) => {
		for (const tag of core.view.installTags) {
			if (tag.enabled && file.tags.includes(tag.label))
				return true;
		}

		return false;
	}).map(e => e.name + ' [' + e.tags.join(', ') + ']');
};

core.events.once('screen-tab-install', async () => {
	core.setToast('progress', 'Retrieving installation manifest...', null, -1, false);
	manifest = await core.view.casc.getInstallManifest();

	core.view.installTags = manifest.tags.map(e => { return { label: e.name, enabled: true, mask: e.mask } });
	core.view.$watch('installTags', () => updateInstallListfile(), { deep: true, immediate: true });

	core.hideToast();
});

// Track when the user clicks to export selected install files.
core.events.on('click-export-install', async () => {
	const userSelection = core.view.selectionInstall;
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
		const file = manifest.files.find(e => e.name === fileName);
		const exportPath = ExportHelper.getExportPath(fileName);

		if (overwriteFiles || !await generics.fileExists(exportPath)) {
			try {
				const data = await core.view.casc.getFile(0, false, false, true, false, file.hash);
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