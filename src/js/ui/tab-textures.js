const core = require('../core');
const log = require('../log');
const BLPFile = require('../casc/blp');

let selectedFile = null;

//let canvas = null;
//let canvasContainer = null;

let previewContainer = null;
let previewInner = null;

core.events.on('user-select-texture', async selection => {
	const first = selection[0];
	if (first && selectedFile !== first) {
		try {
			const file = await core.view.casc.getFileByName(first);
			const blp = new BLPFile(file);

			//if (!canvas || !canvasContainer) {
				//canvasContainer = document.getElementById('texture-preview');
				//canvas = canvasContainer.querySelector('canvas');
			//}

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
		} catch (e) {
			core.setToast('error', 'Unable to open file: ' + first, { 'View Log': () => log.openRuntimeLog() }, 10000);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
});