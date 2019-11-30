const core = require('../core');
const ExportHelper = require('../casc/export-helper');

core.events.once('init', () => {
	// Track selection changes on the video listbox and set first as active entry.
	core.events.on('user-select-video', async selection => {
		// Store the full selection for exporting purposes.
		userSelection = selection;
	});

	// Track when the user clicks to export selected sound files.
	core.events.on('click-export-video', async () => {
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'videos');
		helper.start();
		
		for (const fileName of userSelection) {
			try {
				const data = await core.view.casc.getFileByName(fileName);
				await data.writeToFile(ExportHelper.getExportPath(fileName));
				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});
});