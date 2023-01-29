/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import cp from 'node:child_process';
import constants from './constants';
import * as generics from './generics';
import * as core from './core';
import * as log from './log';

let updateManifest;

/**
 * Check if there are any available updates.
 * Returns a Promise that resolves to true if an update is available.
 */
export const checkForUpdates = async () => {
	try {
		const localManifest = nw.App.manifest;
		const manifestURL = util.format(core.view.config.updateURL, localManifest.flavour) + 'update.json';
		log.write('Checking for updates (%s)...', manifestURL);

		const manifest: any = await generics.getJSON(manifestURL); // NIT: I can't figure out a way where JSON isn't any

		assert(typeof manifest.guid === 'string', 'Update manifest does not contain a valid build GUID');
		assert(typeof manifest.contents === 'object', 'Update manifest does not contain a valid contents list');

		if (manifest.guid !== localManifest.guid) {
			updateManifest = manifest;
			log.write('Update available, prompting using (%s != %s)', manifest.guid, localManifest.guid);
			return true;
		}

		log.write('Not updating (%s == %s)', manifest.guid, localManifest.guid);
		return false;
	} catch (e) {
		log.write('Not updating due to error: %s', e.message);
		return false;
	}
};

/**
 * Apply an outstanding update.
 */
export const applyUpdate = async () => {
	core.view.isBusy++;
	core.view.showLoadScreen('Updating, please wait...');

	log.write('Starting update to %s...', updateManifest.guid);

	const requiredFiles: any[] = []; // NIT: Again, any stuff here because magic object keys
	const entries = Object.entries(updateManifest.contents);

	let progress = core.createProgress(entries.length);
	core.view.loadingTitle = 'Verifying local files...';

	for (let i = 0, n = entries.length; i < n; i++) {
		const [file, meta] = entries[i];

		await progress.step((i + 1) + ' / ' + n);

		const localPath = path.join(constants.INSTALL_PATH, file);
		const node = { file, meta };

		try {
			const stats = await fs.stat(localPath);

			// If the file size is different, skip hashing and just mark for update.
			if (stats.size !== (meta as any).size) {
				log.write('Marking %s for update due to size mismatch (%d != %d)', file, stats.size, (meta as any).size);
				requiredFiles.push(node);
				continue;
			}

			// Verify local sha256 hash with remote one.
			const localHash = await generics.getFileHash(localPath, 'sha256', 'hex');
			if (localHash !== (meta as any).hash) {
				log.write('Marking %s for update due to hash mismatch (%s != %s)', file, localHash, (meta as any).hash);
				requiredFiles.push(node);
				continue;
			}
		} catch (e) {
			// Error thrown, likely due to file not existing.
			log.write('Marking %s for update due to local error: %s', file, e.message);
			requiredFiles.push(node);
		}
	}

	const downloadSize = generics.filesize(requiredFiles.map(e => e.meta.size).reduce((total, val) => total + val));
	log.write('%d files (%s) marked for download.', requiredFiles.length, downloadSize);

	progress = core.createProgress(requiredFiles.length);
	core.view.loadingTitle = 'Downloading updates...';

	const remoteEndpoint = util.format(core.view.config.updateURL, nw.App.manifest.flavour) + 'update';
	for (let i = 0, n = requiredFiles.length; i < n; i++) {
		const node = requiredFiles[i];
		const localFile = path.join(constants.UPDATE.DIRECTORY, node.file);
		log.write('Downloading %s to %s', node.file, localFile);

		await progress.step(util.format('%d / %d (%s)', i + 1, n, downloadSize));
		await generics.downloadFile(remoteEndpoint, localFile, node.meta.ofs, node.meta.compSize, true);
	}

	core.view.loadingTitle = 'Restarting application...';
	await launchUpdater();
};

/**
 * Launch the external updater process and exit.
 */
const launchUpdater = async () => {
	// On the rare occurrence that we've updated the updater, the updater
	// cannot update the updater, so instead we update the updater here.
	const helperApp = path.join(constants.INSTALL_PATH, constants.UPDATE.HELPER);
	const updatedApp = path.join(constants.UPDATE.DIRECTORY, constants.UPDATE.HELPER);

	try {
		const updaterExists = await generics.fileExists(updatedApp);
		if (updaterExists)
			await fs.rename(updatedApp, helperApp);

		// Launch the updater application.
		// NIT: Something changed here and process.pid is no longer a valid argument there, I've removed it for now.
		// const child = cp.spawn(helperApp, [process.pid], { detached: true, stdio: 'ignore' });
		const child = cp.spawn(helperApp, { detached: true, stdio: 'ignore' });
		child.unref();
		process.exit();
	} catch (e) {
		log.write('Failed to restart for update: %s', e.message);
	}
};