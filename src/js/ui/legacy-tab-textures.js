/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const core = require('../core');
const log = require('../log');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const textureExporter = require('./texture-exporter');

core.registerLoadFunc(async () => {
	core.events.on('screen-legacy-tab-textures', async () => {
		if (core.view.listfileTextures.length === 0 && !core.view.isBusy) {
			core.view.setScreen('loading');
			core.view.isBusy++;

			try {
				const blp_files = core.view.mpq.getFilesByExtension('.blp');
				const png_files = core.view.mpq.getFilesByExtension('.png');
				const jpg_files = core.view.mpq.getFilesByExtension('.jpg');

				core.view.listfileTextures = [...blp_files, ...png_files, ...jpg_files];
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
		const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

		core.view.isBusy++;
		log.write('previewing texture file %s', filename);

		try {
			const data = core.view.mpq.getFile(filename);
			if (!data) {
				log.write('failed to load texture: %s', filename);
				core.view.isBusy--;
				return;
			}

			if (ext === '.blp') {
				const buffer = Buffer.from(data);
				const wrapped = new BufferWrapper(buffer);
				const blp = new BLPFile(wrapped);

				core.view.texturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
				core.view.texturePreviewWidth = blp.width;
				core.view.texturePreviewHeight = blp.height;

				let info = '';
				switch (blp.encoding) {
					case 1:
						info = 'Palette';
						break;
					case 2:
						info = 'Compressed ' + (blp.alphaDepth > 1 ? (blp.alphaEncoding === 7 ? 'DXT5' : 'DXT3') : 'DXT1');
						break;
					case 3:
						info = 'ARGB';
						break;
					default:
						info = 'Unsupported [' + blp.encoding + ']';
				}

				core.view.texturePreviewInfo = `${blp.width}x${blp.height} (${info})`;
			} else if (ext === '.png' || ext === '.jpg') {
				const buffer = Buffer.from(data);
				const base64 = buffer.toString('base64');
				const mime_type = ext === '.png' ? 'image/png' : 'image/jpeg';
				const data_url = `data:${mime_type};base64,${base64}`;

				const img = new Image();
				img.onload = () => {
					core.view.texturePreviewWidth = img.width;
					core.view.texturePreviewHeight = img.height;
					core.view.texturePreviewInfo = `${img.width}x${img.height} (${ext.slice(1).toUpperCase()})`;
				};
				img.src = data_url;

				core.view.texturePreviewURL = data_url;
			}
		} catch (e) {
			log.write('failed to preview legacy texture %s: %o', filename, e);
			core.setToast('error', 'unable to preview texture ' + filename, { 'view log': () => log.openRuntimeLog() }, -1);
		}

		core.view.isBusy--;
	});

	core.view.$watch('config.exportChannelMask', () => {
		if (core.view.screen !== 'legacy-tab-textures' || core.view.isBusy)
			return;

		const selection = core.view.selectionTextures;
		if (selection.length > 0) {
			const filename = selection[0];
			const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

			if (ext === '.blp') {
				try {
					const data = core.view.mpq.getFile(filename);
					if (data) {
						const buffer = Buffer.from(data);
						const wrapped = new BufferWrapper(buffer);
						const blp = new BLPFile(wrapped);
						core.view.texturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
					}
				} catch (e) {
					log.write('failed to refresh preview for %s: %o', filename, e);
				}
			}
		}
	});

	core.events.on('click-export-legacy-texture', async () => {
		const selected = core.view.selectionTextures;
		if (selected.length === 0) {
			log.write('no textures selected for export');
			return;
		}

		await textureExporter.exportFiles(selected, false, -1, true);
	});
});
