// This class provides helper functions for managing the Blender add-on
// that ships with wow.export and the userland installation of it.
const path = require('path');
const fsp = require('fs').promises;

const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

module.exports = {
	/**
	 * Open the local directory containing our Blender add-on
	 * using the default explorer application for this OS.
	 */
	openAddonDirectory: () => {
		nw.Shell.openItem(constants.BLENDER.LOCAL_DIR);
	},

	/**
	 * Attempts to locate the latest Blender installation and automatically
	 * install the Blender add-on shipped with this application.
	 */
	startAutomaticInstall: async () => {
		// ToDo: Modify this to work on non-Windows platforms. GH-1.
		core.view.isBusy++;
		core.setToast('progress', 'Installing Blender add-on, please wait...', null, -1, false);
		log.write('Starting automatic installation of Blender add-on...');

		try {
			const entries = await fsp.readdir(constants.BLENDER.DIR, { withFileTypes: true });
			let selectedVersion;

			for (const entry of entries) {
				// Skip non-directories.
				if (!entry.isDirectory())
					continue;

				// Each version directory should be a float.
				const parsed = parseFloat(entry.name);
				if (isNaN(parsed)) {
					log.write('Skipping invalid %s version', entry.name);
					continue;
				}

				if (parsed < constants.BLENDER.MIN_VER) {
					log.write('Skipping out-dated version %s', entry.name);
					continue;
				}

				// Set this as the selected version.
				if (selectedVersion === undefined || parsed > selectedVersion)
					selectedVersion = entry.name;
			}

			if (selectedVersion !== undefined) {
				const addonPath = path.join(constants.BLENDER.DIR, selectedVersion, constants.BLENDER.ADDON_DIR);

				// Delete and re-create our add-on to ensure no cache.
				await generics.deleteDirectory(addonPath);
				await generics.createDirectory(addonPath);

				// Clone our new files over.
				const files = await fsp.readdir(constants.BLENDER.LOCAL_DIR, { withFileTypes: true });
				for (const file of files) {
					// We don't expect any directories in our add-on.
					// Adjust this to be recursive if we ever need to.
					if (file.isDirectory())
						continue;

					const srcPath = path.join(constants.BLENDER.LOCAL_DIR, file.name);
					let destPath = path.join(addonPath, file.name);

					log.write('%s -> %s', srcPath, destPath);
					await fsp.copyFile(srcPath, destPath);
				}

				core.setToast('success', 'The latest add-on version has been installed! (You will need to restart Blender)');
			} else {
				log.write('No valid Blender installation found, add-on install failed.');
				core.setToast('error', 'Sorry, a valid Blender 2.8+ installation was not be detected on your system.');
			}
		} catch (e) {
			log.write('Installation failed due to exception: %s', e.message);
			core.setToast('error', 'Sorry, an unexpected error occurred trying to install the add-on.');
		}

		core.view.isBusy--;
	}
};