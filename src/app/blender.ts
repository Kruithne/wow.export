/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This module provides helper functions for managing the Blender add-on
// that ships with wow.export and the userland installation of it.
import path from 'node:path';
import util from 'node:util';
import fs from 'node:fs/promises';

import { createDirectory, deleteDirectory } from './generics';
import { openShell } from './system';

import Log from './log';
import Constants from './constants';
import { state } from './core';

const PATTERN_ADDON_VER = /"version": \((\d+), (\d+), (\d+)\),/;
const PATTERN_BLENDER_VER = /\d+\.\d+\w?/;

/**
 * Parse a Blender add-on manifest file for the version.
 * @param file - Path to manifest file.
 * @returns Version string or null if not found.
 */
async function parseManifestVersion(file: string): Promise<string | null> {
	try {
		const data = await fs.readFile(file, 'utf8');
		const match = data.match(PATTERN_ADDON_VER);

		if (match)
			return util.format('%d.%d.%d', match[1], match[2], match[3]);
	} catch {
		// Catch: File does not exist or cannot be opened.
	}

	return null;
}

/**
 * Locate available Blender installations on the system.
 * @returns Array of version strings.
 */
async function getBlenderInstallations(): Promise<Array<string>> {
	const installs = Array<string>();

	try {
		const entries = await fs.readdir(Constants.BLENDER.DIR, { withFileTypes: true });

		for (const entry of entries) {
			// Skip non-directories.
			if (!entry.isDirectory())
				continue;

			// Validate version directory names.
			if (!entry.name.match(PATTERN_BLENDER_VER)) {
				Log.write('Skipping invalid Blender installation dir: %s', entry.name);
				continue;
			}

			installs.push(entry.name);
		}
	} catch {
		// Catch: No Blender installation (or cannot access).
	}

	return installs;
}

/**
 * Open the local directory containing our Blender add-on
 * using the default explorer application for this OS.
 */
export async function openAddonDirectory(): Promise<void> {
	openShell(Constants.BLENDER.LOCAL_DIR);
}

/**
 * Attempts to check if the user has the latest version of our Blender
 * add-on installed. If not, they will be prompted to update it.
 */
export async function checkLocalVersion(): Promise<void> {
	Log.write('Checking local Blender add-on version...');

	// Ensure we actually have a Blender installation.
	const versions = await getBlenderInstallations();
	if (versions.length === 0) {
		Log.write('Error: User does not have any Blender installations.');
		return;
	}

	Log.write('Available Blender installations: %s', versions.length > 0 ? versions.join(', ') : 'None');
	versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

	// Check the users latest version meets our minimum requirement.
	const latestVersion = versions.pop();
	if (latestVersion.localeCompare(Constants.BLENDER.MIN_VER, undefined, { numeric: true, sensitivity: 'base' }) < 0) {
		Log.write('Latest Blender install does not meet minimum requirements (%s < %s)', latestVersion, Constants.BLENDER.MIN_VER);
		return;
	}

	const latestManifest = path.join(Constants.BLENDER.LOCAL_DIR, Constants.BLENDER.ADDON_ENTRY);
	const latestAddonVersion = await parseManifestVersion(latestManifest);

	// Files are not included with the installation. Deployment error or user removed them?
	if (latestAddonVersion === null) {
		Log.write('Error: Installation is missing Blender add-on source files?');
		return;
	}

	const blenderManifest = path.join(Constants.BLENDER.DIR, latestVersion, Constants.BLENDER.ADDON_DIR, Constants.BLENDER.ADDON_ENTRY);
	const blenderAddonVersion = await parseManifestVersion(blenderManifest);

	Log.write('Latest add-on version: %s, Blender add-on version: %s', latestAddonVersion, blenderAddonVersion);

	if (latestAddonVersion > blenderAddonVersion) {
		Log.write('Prompting user for Blender add-on update...');
		state.setToast('info', 'A newer version of the Blender add-on is available for you.', {
			'Install': () => state.setScreen('blender', true),
			'Maybe Later': () => false
		}, -1, false);
	}
}

/**
 * Attempts to locate the latest Blender installation and automatically
 * install the Blender add-on shipped with this application.
 */
export async function startAutomaticInstall(): Promise<void> {
	state.isBusy++;
	state.setToast('progress', 'Installing Blender add-on, please wait...', null, -1, false);
	Log.write('Starting automatic installation of Blender add-on...');

	try {
		const versions = await getBlenderInstallations();
		let installed = false;

		for (const version of versions) {
			if (version >= Constants.BLENDER.MIN_VER) {
				const addonPath = path.join(Constants.BLENDER.DIR, version, Constants.BLENDER.ADDON_DIR);
				Log.write('Targeting Blender version %s (%s)', version, addonPath);

				// Delete and re-create our add-on to ensure no cache.
				await deleteDirectory(addonPath);
				await createDirectory(addonPath);

				// Clone our new files over.
				const files = await fs.readdir(Constants.BLENDER.LOCAL_DIR, { withFileTypes: true });
				for (const file of files) {
					// We don't expect any directories in our add-on.
					// Adjust this to be recursive if we ever need to.
					if (file.isDirectory())
						continue;

					const srcPath = path.join(Constants.BLENDER.LOCAL_DIR, file.name);
					const destPath = path.join(addonPath, file.name);

					Log.write('%s -> %s', srcPath, destPath);
					await fs.copyFile(srcPath, destPath);
				}

				installed = true;
			}
		}

		if (installed) {
			state.setToast('success', 'The latest add-on version has been installed! (You will need to restart Blender)');
		} else {
			Log.write('No valid Blender installation found, add-on install failed.');
			state.setToast('error', 'Sorry, a valid Blender 2.8+ installation was not be detected on your system.', null, -1);
		}
	} catch (e) {
		Log.write('Installation failed due to exception: %s', e.message);
		state.setToast('error', 'Sorry, an unexpected error occurred trying to install the add-on.', null, -1);
	}

	state.isBusy--;
}

export default {
	checkLocalVersion,
	getBlenderInstallations,
	openAddonDirectory,
	startAutomaticInstall
};