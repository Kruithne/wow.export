/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// This module provides helper functions for managing the Blender add-on
// that ships with wow.export and the userland installation of it.
const path = require('path');
const util = require('util');
const fsp = require('fs').promises;

const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

const PATTERN_ADDON_VER = /"version": \((\d+), (\d+), (\d+)\),/;
const PATTERN_BLENDER_VER = /\d+\.\d+\w?/;

/**
 * Parse a Blender add-on manifest file for the version.
 * @param {string} file 
 */
const parseManifestVersion = async (file) => {
	try {
		const data = await fsp.readFile(file, 'utf8');
		const match = data.match(PATTERN_ADDON_VER);

		if (match)
			return util.format('%d.%d.%d', match[1], match[2], match[3]);
	} catch {
		// Catch: File does not exist or cannot be opened.
	}

	return null;
};

/**
 * Locate available Blender installations on the system.
 * Returns a list of versions.
 */
const getBlenderInstallations = async () => {
	const installs = [];

	try {
		const entries = await fsp.readdir(constants.BLENDER.DIR, { withFileTypes: true });

		for (const entry of entries) {
			// Skip non-directories.
			if (!entry.isDirectory())
				continue;

			// Validate version directory names.
			if (!entry.name.match(PATTERN_BLENDER_VER)) {
				log.write('Skipping invalid Blender installation dir: %s', entry.name);
				continue;
			}

			installs.push(entry.name);
		}
	} catch {
		// Catch: No Blender installation (or cannot access).
	}

	return installs;
};

module.exports = {
	/**
	 * Open the local directory containing our Blender add-on
	 * using the default explorer application for this OS.
	 */
	openAddonDirectory: () => {
		nw.Shell.openItem(constants.BLENDER.LOCAL_DIR);
	},

	/**
	 * Attempts to check if the user has the latest version of our Blender
	 * add-on installed. If not, they will be prompted to update it.
	 */
	checkLocalVersion: async () => {
		log.write('Checking local Blender add-on version...');

		// Ensure we actually have a Blender installation.
		const versions = await getBlenderInstallations();
		if (versions.length === 0) {
			log.write('Error: User does not have any Blender installations.');
			return;
		}

		log.write('Available Blender installations: %s', versions.length > 0 ? versions.join(', ') : 'None');
		const blenderVersion = versions.sort().pop();

		// Check the users latest version meets our minimum requirement.
		if (blenderVersion < constants.BLENDER.MIN_VER) {
			log.write('Latest Blender install does not meet minimum requirements (%s < %s)', blenderVersion, constants.BLENDER.MIN_VER);
			return;
		}

		const latestManifest = path.join(constants.BLENDER.LOCAL_DIR, constants.BLENDER.ADDON_ENTRY);
		const latestAddonVersion = await parseManifestVersion(latestManifest);

		// Files are not included with the installation. Deployment error or user removed them?
		if (latestAddonVersion === null) {
			log.write('Error: Installation is missing Blender add-on source files?');
			return;
		}

		const blenderManifest = path.join(constants.BLENDER.DIR, blenderVersion, constants.BLENDER.ADDON_DIR, constants.BLENDER.ADDON_ENTRY);
		const blenderAddonVersion = await parseManifestVersion(blenderManifest);

		log.write('Latest add-on version: %s, Blender add-on version: %s', latestAddonVersion, blenderAddonVersion);

		if (latestAddonVersion > blenderAddonVersion) {
			log.write('Prompting user for Blender add-on update...');
			core.setToast('info', 'A newer version of the Blender add-on is available for you.', {
				'Install': () => core.view.setScreen('blender', true),
				'Maybe Later': () => false
			}, -1, false);
		}
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
			const versions = await getBlenderInstallations();
			let installed = false;

			for (const version of versions) {
				if (version >= constants.BLENDER.MIN_VER) {
					const addonPath = path.join(constants.BLENDER.DIR, version, constants.BLENDER.ADDON_DIR);
					log.write('Targeting Blender version %s (%s)', version, addonPath);

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

					installed = true;
				}
			}

			if (installed) {
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