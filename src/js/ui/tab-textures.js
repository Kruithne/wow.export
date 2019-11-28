const core = require('../core');
const log = require('../log');
const util = require('util');
const BLPFile = require('../casc/blp');

let selectedFile = null;

let previewContainer = null;
let previewInner = null;

core.events.on('user-select-texture', async selection => {
	const first = selection[0];
	if (!core.isBusy && first && selectedFile !== first) {
		core.isBusy++;
		core.setToast('progress', util.format('Loading %s, please wait...', first));

		try {
			const file = await core.view.casc.getFileByName(first);
			const blp = new BLPFile(file);

			if (!previewContainer || !previewInner) {
				previewContainer = document.getElementById('texture-preview');
				previewInner = previewContainer.querySelector('div');
			}

			const canvas = document.createElement('canvas');
			canvas.width = blp.width;
			canvas.height = blp.height;

			blp.drawToCanvas(canvas);

			previewInner.style.backgroundImage = 'url(' + canvas.toDataURL() + ')';
			previewContainer.style.maxHeight = blp.height + 'px';
			previewContainer.style.maxWidth = blp.width + 'px';

			selectedFile = first;
			core.hideToast();
		} catch (e) {
			core.setToast('error', 'Unable to open file: ' + first, { 'View Log': () => log.openRuntimeLog() }, 10000);
			log.write('Failed to open CASC file: %s', e.message);
		}

		core.isBusy--;
	}
});