/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const path = require('path');
const assert = require('assert').strict;
const fsp = require('fs').promises;
const cp = require('child_process');
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

let updateManifest;

/**
 * Check if there are any available updates.
 * Returns a Promise that resolves to true if an update is available.
 */
const checkForUpdates = async () => false;

/**
 * Apply an outstanding update.
 */
const applyUpdate = async () => {
	core.view.isBusy++;
	core.view.showLoadScreen('Updating, please wait...');

	log.write('Starting update to %s...', updateManifest.guid);

	const requiredFiles = [];
	const entries = Object.entries(updateManifest.contents);

	let progress = core.createProgress(entries.length);
	core.view.loadingTitle = 'Verifying local files...';

	for (let i = 0, n = entries.length; i < n; i++) {
		const [file, meta] = entries[i];

		await progress.step((i + 1) + ' / ' + n);

		const localPath = path.join(constants.INSTALL_PATH, file);
		const node = { file, meta };

		try {
			const stats = await fsp.stat(localPath);

			// If the file size is different, skip hashing and just mark for update.
			if (stats.size !== meta.size) {
				log.write('Marking %s for update due to size mismatch (%d != %d)', file, stats.size, meta.size);
				requiredFiles.push(node);
				continue;
			}

			// Verify local sha256 hash with remote one.
			const localHash = await generics.getFileHash(localPath, 'sha256', 'hex');
			if (localHash !== meta.hash) {
				log.write('Marking %s for update due to hash mismatch (%s != %s)', file, localHash, meta.hash);
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
			await fsp.rename(updatedApp, helperApp);

		// Launch the updater application.
		const child = cp.spawn(helperApp, [process.pid], { detached: true, stdio: 'ignore' });
		child.unref();
		process.exit();
	} catch (e) {
		log.write('Failed to restart for update: %s', e.message);
	}
};

module.exports = { checkForUpdates, applyUpdate };