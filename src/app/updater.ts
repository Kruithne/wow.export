/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import cp from 'node:child_process';

import { get, downloadFile, filesize, getFileHash, fileExists } from './generics';

import Log from './log';
import Constants from './constants';
import { state, createProgress } from './core';

interface UpdateFileContents {
	hash: string,
	size: number,
	ofs: number,
	compSize: number,
}

interface UpdateRequiredFile {
	file: string,
	meta: UpdateFileContents,
}

interface UpdateManifest {
	guid?: string,
	contents?: {
		[key: string]: UpdateFileContents,
	},
}

let updateManifest: UpdateManifest;

/**
 * Check if there are any available updates.
 * @returns True if an update is available, false otherwise.
 */
export async function checkForUpdates(): Promise<boolean> {
	try {
		const localManifest = nw.App.manifest;
		const manifestURL = util.format(state.config.updateURL, localManifest.flavour) + 'update.json';
		Log.write('Checking for updates (%s)...', manifestURL);

		const manifest: UpdateManifest = await get(manifestURL).then(res => res.json());

		assert(typeof manifest.guid === 'string', 'Update manifest does not contain a valid build GUID');
		assert(typeof manifest.contents === 'object', 'Update manifest does not contain a valid contents list');

		if (manifest.guid !== localManifest.guid) {
			updateManifest = manifest;
			Log.write('Update available, prompting using (%s != %s)', manifest.guid, localManifest.guid);
			return true;
		}

		Log.write('Not updating (%s == %s)', manifest.guid, localManifest.guid);
		return false;
	} catch (e) {
		Log.write('Not updating due to error: %s', e.message);
		return false;
	}
}

/** Apply an outstanding update. */
export async function applyUpdate(): Promise<void> {
	state.isBusy++;
	state.showLoadScreen('Updating, please wait...');

	Log.write('Starting update to %s...', updateManifest.guid);

	const requiredFiles: Array<UpdateRequiredFile> = [];
	const entries = Object.entries(updateManifest.contents);

	let progress = createProgress(entries.length);
	state.loadingTitle = 'Verifying local files...';

	for (let i = 0, n = entries.length; i < n; i++) {
		const [file, meta] = entries[i];

		await progress.step((i + 1) + ' / ' + n);

		const localPath: string = path.join(Constants.INSTALL_PATH, file);
		const node: UpdateRequiredFile = { file, meta };

		try {
			const stats = await fs.stat(localPath);

			// If the file size is different, skip hashing and just mark for update.
			if (stats.size !== meta.size) {
				Log.write('Marking %s for update due to size mismatch (%d != %d)', file, stats.size, meta.size);
				requiredFiles.push(node);
				continue;
			}

			// Verify local sha256 hash with remote one.
			const localHash = await getFileHash(localPath, 'sha256', 'hex');
			if (localHash !== meta.hash) {
				Log.write('Marking %s for update due to hash mismatch (%s != %s)', file, localHash, meta.hash);
				requiredFiles.push(node);
				continue;
			}
		} catch (e) {
			// Error thrown, likely due to file not existing.
			Log.write('Marking %s for update due to local error: %s', file, e.message);
			requiredFiles.push(node);
		}
	}

	const downloadSize = filesize(requiredFiles.map(e => e.meta.size).reduce((total, val) => total + val));
	Log.write('%d files (%s) marked for download.', requiredFiles.length, downloadSize);

	progress = createProgress(requiredFiles.length);
	state.loadingTitle = 'Downloading updates...';

	const remoteEndpoint = util.format(state.config.updateURL, nw.App.manifest.flavour) + 'update';
	for (let i = 0, n = requiredFiles.length; i < n; i++) {
		const node = requiredFiles[i];
		const localFile = path.join(Constants.UPDATE.DIRECTORY, node.file);
		Log.write('Downloading %s to %s', node.file, localFile);

		await progress.step(util.format('%d / %d (%s)', i + 1, n, downloadSize));
		await downloadFile(remoteEndpoint, localFile, node.meta.ofs, node.meta.compSize, true);
	}

	state.loadingTitle = 'Restarting application...';

	// On the rare occurrence that we've updated the updater, the updater
	// cannot update the updater, so instead we update the updater here.
	const helperApp = path.join(Constants.INSTALL_PATH, Constants.UPDATE.HELPER);
	const updatedApp = path.join(Constants.UPDATE.DIRECTORY, Constants.UPDATE.HELPER);

	try {
		const updaterExists = await fileExists(updatedApp);
		if (updaterExists)
			await fs.rename(updatedApp, helperApp);

		// Launch the updater application.
		const child = cp.spawn(helperApp, [process.pid.toString()], { detached: true, stdio: 'ignore' });
		child.unref();
		process.exit();
	} catch (e) {
		Log.write('Failed to restart for update: %s', e.message);
	}
}

export default {
	checkForUpdates,
	applyUpdate
};