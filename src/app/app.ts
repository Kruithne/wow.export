/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This is the main entry point for the application. This context/scope will be mixed with
// the browser context, so everything exposed here will be accessible from the browser
// and vice-versa.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { filesize } from './generics';
import { win } from './nwjs';

import Updater from './updater';
import Blender from './blender';
import ExternalLinks from './external-links';
import Constants from './constants';
import Log from './log';
import Config from './config';
import TactKeys from './casc/tact-keys';
import State from './state';
import Events from './events';

// The `File` class does not implement the `path` property in the official File API.
// However, nw.js adds this property to get the native path of a file.
// See: https://developer.mozilla.org/en-US/docs/Web/API/File
// See: https://docs.nwjs.io/en/latest/References/Changes%20to%20DOM/#fileitempath
interface NWFile {
	path: string;
}

(async () => {
	// Prevent files from being dropped onto the window. These are over-written
	// later but we disable here to prevent them working if init fails.
	window.ondragover = (e: DragEvent) => {
		e.preventDefault(); return false;
	};
	window.ondrop = (e: DragEvent) => {
		e.preventDefault(); return false;
	};

	// Reset taskbar progress in-case it's stuck.
	win.setProgressBar(-1);

	// Ensure we exit when the window is closed.
	win.on('close', () => process.exit(0));

	if (process.env.NODE_ENV === 'development') {
		// Open DevTools if we're in debug mode.
		win.showDevTools();

		// Add a quick-reload keybinding.
		document.addEventListener('keydown', (e) => {
			if (e.key === 'F5')
				chrome.runtime.reload();
		});
	}

	// Force all links to open in the users default application.
	document.addEventListener('click', function(e) {
		const target = e.target as HTMLAnchorElement;
		if (!target.matches('[data-external]'))
			return;

		e.preventDefault();
		ExternalLinks.openExternalLink(target.getAttribute('data-external'));
	});

	// Wait for the DOM to be loaded.
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

	// Append the application version to the title bar.
	document.title += ' v' + nw.App.manifest.version;

	const manifest = nw.App.manifest;
	const cpus = os.cpus();

	Log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
	Log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform(), os.arch(), cpus[0].model, cpus.length, filesize(os.freemem()), filesize(os.totalmem()));
	Log.write('INSTALL_PATH %s DATA_PATH %s', Constants.INSTALL_PATH, Constants.DATA_PATH);

	// Load configuration.
	await Config.load();

	// Set-up default export directory if none configured.
	if (State.config.exportDirectory === '') {
		State.config.exportDirectory = path.join(os.homedir(), 'wow.export');
		Log.write('No export directory set, setting to %s', State.config.exportDirectory);
	}

	// Set-up proper drag/drop handlers.
	let dropStack = 0;
	window.ondragenter = (e: DragEvent) => {
		e.preventDefault();

		// Converting local files while busy shouldn't end badly, but it seems
		// weird to let people do this on loading screens.
		if (State.isBusy)
			return false;

		dropStack++;

		// We're already showing a prompt, don't re-process it.
		if (State.fileDropPrompt !== null)
			return false;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath: string = (files[0] as unknown as NWFile).path;
			const handler = State.getDropHandler(firstFilePath);

			if (handler) {
				let count = 0;
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some((ext: string) => check.endsWith(ext)))
						count++;
				}

				if (count > 0)
					State.fileDropPrompt = handler.prompt(count);
			} else {
				State.fileDropPrompt = 'That file cannot be converted.';
			}
		}

		return false;
	};

	window.ondrop = (e: DragEvent) => {
		e.preventDefault();
		State.fileDropPrompt = null;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath = (files[0] as unknown as NWFile).path;
			const handler = State.getDropHandler(firstFilePath);

			if (handler) {
				// Since dataTransfer.files is a FileList, we need to iterate it the old fashioned way.
				const include = Array<string>();
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some((ext: string) => check.endsWith(ext))) {
						const filePath = (file as unknown as NWFile).path;
						include.push(filePath);
					}
				}

				if (include.length > 0)
					handler.process(include);
			}
		}
		return false;
	};

	window.ondragleave = (e: DragEvent) => {
		e.preventDefault();

		// Window drag events trigger for all elements. Ensure that there is currently
		// nothing being dragged once the dropStack is empty.
		dropStack--;
		if (dropStack === 0)
			State.fileDropPrompt = null;
	};

	// Load cachesize, a file used to track the overall size of the cache directory
	// without having to calculate the real size before showing to users. Fast and reliable.
	fs.readFile(Constants.CACHE.SIZE, 'utf8').then(data => {
		State.cacheSize = Number(data) || 0;
	}).catch(() => {
		// File doesn't exist yet, don't error.
	}).finally(() => {
		let updateTimer: NodeJS.Timeout;

		// Create a watcher programmatically *after* assigning the initial value
		// to prevent a needless file write by triggering itself during init.
		State.$watch('cacheSize', function(nv: number) {
			// Clear any existing timer running.
			clearTimeout(updateTimer);

			// We buffer this call by SIZE_UPDATE_DELAY so that we're not writing
			// to the file constantly during heavy cache usage. Postponing until
			// next tick would not help due to async and potential IO/net delay.
			updateTimer = setTimeout(() => {
				fs.writeFile(Constants.CACHE.SIZE, nv.toString(), 'utf8');
			}, Constants.CACHE.SIZE_UPDATE_DELAY);
		});
	});

	// Load/update BLTE decryption keys.
	TactKeys.load();

	// Check for updates (without blocking).
	if (process.env.NODE_ENV !== 'development') {
		Updater.checkForUpdates().then(updateAvailable => {
			if (updateAvailable) {
				// Update is available, prompt to update. If user declines,
				// begin checking the local Blender add-on version.
				State.setToast('info', 'A new update is available. You should update, it\'s probably really cool!', {
					'Update Now': () => Updater.applyUpdate(),
					'Maybe Later': () => Blender.checkLocalVersion()
				}, -1, false);
			} else {
				// No update available, start checking Blender add-on.
				Blender.checkLocalVersion();
			}
		});
	} else {
		// Debug mode, go straight to Blender add-on check.
		Blender.checkLocalVersion();
	}

	// Load the changelog when the user opens the screen.
	Events.on('screen-changelog', () => {
		setImmediate(async () => {
			const element = document.getElementById('changelog-text');

			if (process.env.NODE_ENV !== 'development') {
				try {
					const text = await fs.readFile('./src/CHANGELOG.md', 'utf8');
					element.textContent = text;
				} catch (e) {
					element.textContent = 'Error loading changelog';
				}
			} else {
				element.textContent = 'Cannot load changelog in DEBUG mode';
			}
		});
	});

	// Set source select as the currently active interface screen.
	State.setScreen('source-select');
})();