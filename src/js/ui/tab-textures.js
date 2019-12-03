const core = require('../core');
const log = require('../log');
const util = require('util');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');

let isLoading = false;
let selectedFile = null;

const EXPORT_TYPES = {
	'PNG': { mime: 'image/png', ext: '.png' },
	'JPG': { mime: 'image/jpeg', ext: '.jpg' },
	'BMP': { mime: 'image/bmp', ext: '.bmp' }
};

const previewTexture = async (texture) => {
	isLoading = true;
	const toast = core.delayToast(200, 'progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {			
		const file = await core.view.casc.getFileByName(texture);
		const blp = new BLPFile(file);

		const view = core.view;
		view.texturePreviewURL = blp.getDataURL(view.config.exportTextureAlpha);
		view.texturePreviewWidth = blp.width;
		view.texturePreviewHeight = blp.height;

		selectedFile = texture;
		toast.cancel();
	} catch (e) {
		toast.cancel();
		core.setToast('error', 'Unable to open file: ' + texture, { 'View Log': () => log.openRuntimeLog() });
		log.write('Failed to open CASC file: %s', e.message);
	}

	isLoading = false;
};

const exportFiles = async (files, isLocal = false) => {
	const helper = new ExportHelper(files.length, 'texture');
	helper.start();

	const format = core.view.config.exportTextureFormat;
	const type = EXPORT_TYPES[format];

	let canvas;
	for (const fileName of files) {
		try {
			const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFileByName(fileName));
			let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);

			if (format === 'BLP') {
				// Export as raw file with no conversion.
				await data.writeToFile(exportPath);
			} else {
				// Swap file extension for the new one.
				exportPath = ExportHelper.replaceExtension(exportPath, type.ext);
				const blp = new BLPFile(data);

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
};

// Register a drop handler for BLP files.
core.registerDropHandler({
	ext: ['.blp'],
	prompt: count => util.format('Export %d textures as %s', count, core.view.config.exportTextureFormat),
	process: files => exportFiles(files, true)
});

core.events.once('init', () => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	core.view.$watch('config.exportTextureAlpha', () => {
		if (!isLoading && selectedFile !== null)
			previewTexture(selectedFile);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.view.$watch('selectionTextures', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first)
			previewTexture(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		const userSelection = core.view.selectionTextures;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection);
	});
});