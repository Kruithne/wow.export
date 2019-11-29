const path = require('path');
const core = require('../core');
const log = require('../log');
const util = require('util');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');

let isLoading = false;
let selectedFile = null;
let userSelection = [];

let previewContainer = null;
let previewInner = null;

const EXPORT_TYPES = {
	'PNG': { mime: 'image/png', ext: '.png' },
	'JPG': { mime: 'image/jpeg', ext: '.jpg' },
	'BMP': { mime: 'image/bmp', ext: '.bmp' }
};

const previewTexture = async (texture) => {
	isLoading = true;
	const toast = core.delayToast(200, 'progress', util.format('Loading %s, please wait...', texture), null, -1, false);

	try {
		const file = await core.view.casc.getFileByName(texture);
		const blp = new BLPFile(file);

		if (!previewContainer || !previewInner) {
			previewContainer = document.getElementById('texture-preview');
			previewInner = previewContainer.querySelector('div');
		}

		const canvas = document.createElement('canvas');
		canvas.width = blp.width;
		canvas.height = blp.height;

		blp.drawToCanvas(canvas, 0, core.view.config.exportTextureAlpha);

		previewInner.style.backgroundImage = 'url(' + canvas.toDataURL() + ')';
		previewContainer.style.maxHeight = blp.height + 'px';
		previewContainer.style.maxWidth = blp.width + 'px';

		selectedFile = texture;
		toast.cancel();
	} catch (e) {
		toast.cancel();
		core.setToast('error', 'Unable to open file: ' + texture, { 'View Log': () => log.openRuntimeLog() });
		log.write('Failed to open CASC file: %s', e.message);
	}

	isLoading = false;
};

core.events.once('init', () => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	core.view.$watch('config.exportTextureAlpha', () => {
		if (!isLoading && selectedFile !== null)
			previewTexture(selectedFile);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.events.on('user-select-texture', async selection => {
		// Store the full selection for exporting purposes.
		console.log(selection);
		userSelection = selection;

		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first)
			previewTexture(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'texture');
		helper.start();

		const format = core.view.config.exportTextureFormat;
		const type = EXPORT_TYPES[format];

		let canvas;
		for (const fileName of userSelection) {
			try {
				const file = await core.view.casc.getFileByName(fileName);
				let exportPath = ExportHelper.getExportPath(fileName);

				if (format === 'BLP') {
					// Export as raw file with no conversion.
					await file.writeToFile(exportPath);
				} else {
					// Swap file extension for the new one.
					exportPath = ExportHelper.replaceExtension(exportPath, type.ext);
					const blp = new BLPFile(file);

					// Re-use canvas node for this batch of renders.
					if (!canvas)
						canvas = document.createElement('canvas');

					canvas.width = blp.width;
					canvas.height = blp.height;

					blp.drawToCanvas(canvas, 0, core.view.config.exportTextureAlpha);

					const buf = await BufferWrapper.fromCanvas(canvas, type.mime);
					await buf.writeToFile(exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});
});