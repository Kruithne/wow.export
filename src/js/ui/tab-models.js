const core = require('../core');
const log = require('../log');
const util = require('util');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');

let isLoading = false;
let selectedFile = null;
let userSelection = [];

//let previewContainer = null;
//let previewInner = null;

const previewModel = async (fileName) => {
	isLoading = true;
	const toast = core.delayToast(200, 'progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	log.write('Previewing model %s', fileName);

	try {
		//const file = await core.view.casc.getFileByName(fileName);

		selectedFile = fileName;
		toast.cancel();
	} catch (e) {
		toast.cancel();
		core.setToast('error', 'Unable to open file: ' + fileName, { 'View Log': () => log.openRuntimeLog() });
		log.write('Failed to open CASC file: %s', e.message);
	}

	isLoading = false;
};

const exportFiles = async (files, isLocal = false) => {
	const helper = new ExportHelper(files.length, 'model');
	helper.start();

	const format = core.view.config.exportModelFormat;
	for (const fileName of files) {
		try {
			const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFileByName(fileName));
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);

			if (format === 'M2/WMO') {
				// Export as raw file with no conversion.
				await data.writeToFile(exportPath);
			} else {
				// ToDo: M2/WMO conversion.
			}

			helper.mark(fileName, true);
		} catch (e) {
			helper.mark(fileName, false, e.message);
		}
	}

	helper.finish();
};

/**
 * Update the 3D model listfile.
 * Invoke when users change the visibility settings for model types.
 */
const updateListfile = () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM2)
		modelExt.push('.m2');
	
	if (core.view.config.modelsShowWMO)
		modelExt.push('.wmo');

	// Create a new listfile using the given configuration.
	core.view.listfileModels = listfile.getFilenamesByExtension(modelExt);
};

// Register a drop handler for M2/WMO files.
core.registerDropHandler({
	ext: ['.m2', '.wmo'],
	prompt: count => util.format('Export %d models as %s', count, core.view.config.exportModelFormat),
	process: files => exportFiles(files, true)
});

core.events.once('init', () => {
	// Track changes to the visible model listfile types.
	core.view.$watch('config.modelsShowM2', updateListfile);
	core.view.$watch('config.modelsShowWMO', updateListfile);

	// Track selection changes on the model listbox and preview first model.
	core.events.on('user-select-mode;', async selection => {
		// Store the full selection for exporting purposes.
		userSelection = selection;

		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first)
			previewModel(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-model', async () => {
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection, false);
	});
});