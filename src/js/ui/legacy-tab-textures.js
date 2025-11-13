/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const core = require('../core');
const log = require('../log');

core.registerLoadFunc(async () => {
	core.events.on('screen-legacy-tab-textures', async () => {
		if (core.view.listfileTextures.length === 0 && !core.view.isBusy) {
			core.view.setScreen('loading');
			core.view.isBusy++;

			try {
				const files = core.view.mpq.getFilesByExtension('.blp');
				core.view.listfileTextures = files.map(f => f);
			} catch (e) {
				log.write('failed to load legacy textures: %o', e);
			}

			core.view.isBusy--;
			core.view.setScreen('legacy-tab-textures');
		}
	});

	core.view.$watch('selectionTextures', async selection => {
		if (core.view.screen !== 'legacy-tab-textures' || selection.length === 0)
			return;

		const filename = selection[0];

		try {
			const data = core.view.mpq.getFile(filename);
			if (!data) {
				log.write('failed to load texture: %s', filename);
				return;
			}

			// stub: would need blp -> image conversion here
			core.view.texturePreviewURL = '';
			core.view.texturePreviewInfo = filename;
		} catch (e) {
			log.write('failed to preview texture: %o', e);
		}
	});

	core.events.on('click-export-legacy-texture', async () => {
		// stub: export functionality
		log.write('legacy texture export not yet implemented');
	});
});
