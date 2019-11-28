const core = require('../core');
const log = require('../log');
const util = require('util');
const BLPFile = require('../casc/blp');

let isLoading = false;
let selectedFile = null;
let userSelection = [];

let previewContainer = null;
let previewInner = null;

const previewTexture = async (texture) => {
	isLoading = true;
	const toast = core.delayToast(500, 'progress', util.format('Loading %s, please wait...', texture));

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
		core.setToast('error', 'Unable to open file: ' + texture, { 'View Log': () => log.openRuntimeLog() }, 10000);
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
		userSelection = selection;

		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first)
			previewTexture(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		const count = userSelection.length;
		if (count === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.', {}, 10000);
			return;
		}

		core.view.isBusy++;
		let toastTag = count > 1 ? count + ' textures' : userSelection[0];
		core.setToast('progress', 'Exporting ' + toastTag + ', please wait...');

		let failed = 0;
		for (const fileName of userSelection) {
			try {
				const file = await core.view.casc.getFileByName(fileName);
				// ToDo: Actually export somewhere.
			} catch (e) {
				failed++;
				log.write('Failed to export %s (%s)', fileName, e.message);
			}
		}

		if (failed === 0) {
			// Everything exported successfully.
			core.setToast('success', 'Successfully exported ' + toastTag, {}, 10000);
		} else if (failed < count) {
			// Partial success, some files failed.
			core.setToast('info', util.format('Export complete, but %d files failed to export', failed), { 'View Log': () => log.openRuntimeLog() }, 10000);
		} else {
			// Everything failed to export, prompt user with log link.
			core.setToast('error', 'Unable to export ' + toastTag, { 'View Log': () => log.openRuntimeLog() }, 10000);
		}
		core.view.isBusy--;
	});
});