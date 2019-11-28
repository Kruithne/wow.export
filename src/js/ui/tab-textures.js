const core = require('../core');
const log = require('../log');
const util = require('util');
const BLPFile = require('../casc/blp');

let selectedFile = null;

let previewContainer = null;
let previewInner = null;

const previewTexture = async (texture) => {
	core.isBusy++;
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

		blp.drawToCanvas(canvas, 0, !core.view.config.exportTextureAlpha);

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

	core.isBusy--;
};

core.events.once('init', () => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	core.view.$watch('config.exportTextureAlpha', () => {
		if (selectedFile !== null)
			previewTexture(selectedFile);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.events.on('user-select-texture', async selection => {
		const first = selection[0];
		if (!core.isBusy && first && selectedFile !== first)
			previewTexture(first);
	});
});