const core = require('../core');
const log = require('../log');
const BLPFile = require('../casc/blp');

let selectedFile = null;
let canvas = null;
core.events.on('user-select-texture', async selection => {
	const first = selection[0];
	if (first && selectedFile !== first) {
		try {
			const file = await core.view.casc.getFileByName(first);
			const blp = new BLPFile(file);

			if (!canvas)
				canvas = document.getElementById('texture-preview');

			canvas.width = blp.width;
			canvas.height = blp.height;

			blp.drawToCanvas(canvas);
			selectedFile = first;
		} catch (e) {
			core.setToast('error', 'Unable to open file: ' + first, { 'View Log': () => log.openRuntimeLog() }, 10000);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
});