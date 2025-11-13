/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const core = require('../core');
const log = require('../log');
const path = require('path');
const fsp = require('fs').promises;

let files_loaded = false;

core.registerLoadFunc(async () => {
	core.events.on('screen-legacy-tab-files', async () => {
		if (!files_loaded && !core.view.isBusy) {
			core.view.setScreen('loading');
			core.view.isBusy++;

			try {
				const files = core.view.mpq.getAllFiles();
				core.view.listfileRaw = files;
				files_loaded = true;
			} catch (e) {
				log.write('Failed to load legacy files: %o', e);
			}

			core.view.isBusy--;
			core.view.setScreen('legacy-tab-files');
		}
	});

	core.events.on('click-export-legacy-file', async () => {
		const selection = core.view.selectionRaw;
		if (selection.length === 0)
			return;

		core.view.isBusy++;

		try {
			const exportDir = core.view.config.exportDirectory;
			let last_export_path = null;

			for (const display_path of selection) {
				const data = core.view.mpq.getFile(display_path);
				if (!data) {
					log.write('Failed to read file: %s', display_path);
					continue;
				}

				const output_path = path.join(exportDir, display_path);
				const output_dir = path.dirname(output_path);

				await fsp.mkdir(output_dir, { recursive: true });
				await fsp.writeFile(output_path, new Uint8Array(data));

				last_export_path = output_path;
				log.write('Exported: %s', display_path);
			}

			if (last_export_path) {
				const export_dir = path.dirname(last_export_path);
				const toast_opt = { 'View in Explorer': () => nw.Shell.openItem(export_dir) };

				if (selection.length > 1)
					core.setToast('success', `Successfully exported ${selection.length} files.`, toast_opt, -1);
				else
					core.setToast('success', `Successfully exported ${path.basename(last_export_path)}.`, toast_opt, -1);
			}
		} catch (e) {
			log.write('Failed to export legacy files: %o', e);
			core.setToast('error', 'Failed to export files');
		}

		core.view.isBusy--;
	});
});
