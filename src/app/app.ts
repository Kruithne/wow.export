/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This is the main entry point for the application. This context/scope will be mixed with
// the browser context, so everything exposed here will be accessible from the browser
// and vice-versa.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import util from 'node:util';

import { reactive, watch } from 'vue';

import Updater from './updater';
import Blender from './blender';
import ExternalLinks from './external-links';
import Constants from './constants';
import Log from './log';
import Config from './config';
import TactKeys from './casc/tact-keys';
import { state, setScreen, setToast } from './core';
import Events from './events';
import CrashHandler from './crash-handler';

import { createApp } from 'vue';
import { filesize, ping } from './generics';
import { setTrayProgress, win, restartApplication } from './system';

// Import UI modules as side-effects.
import './ui/tab-textures';
import './ui/tab-items';
import './ui/tab-audio';
import './ui/tab-models';
import './ui/tab-maps';
import './ui/tab-install';
import './ui/tab-data';
import './ui/tab-raw';
import './ui/tab-text';
import './ui/tab-videos';

import App from './components/App.vue';
import ComponentCheckboxList from './components/CheckBoxList.vue';
import ComponentContextMenu from './components/ContextMenu.vue';
import ComponentDataTable from './components/DataTable.vue';
import ComponentFileField from './components/FileField.vue';
import ComponentItemListBox from './components/ItemListBox.vue';
import ComponentListBox from './components/ListBox.vue';
import ComponentListBoxB from './components/ListBoxB.vue';
import ComponentMapViewer from './components/MapViewer.vue';
import ComponentModelViewer from './components/ModelViewer.vue';
import ComponentMenuButton from './components/MenuButton.vue';
import ComponentResizeLayer from './components/ResizeLayer.vue';
import ComponentSlider from './components/SliderComponent.vue';

// Register Node.js error handlers.
process.on('unhandledRejection', CrashHandler.handleUnhandledRejection);
process.on('uncaughtException', CrashHandler.handleUncaughtException);

(async (): Promise<void> => {
	// Prevent files from being dropped onto the window.
	window.ondragover = (e: DragEvent): boolean => {
		e.preventDefault(); return false;
	};
	window.ondrop = (e: DragEvent): boolean => {
		e.preventDefault(); return false;
	};

	// Reset taskbar progress in-case it's stuck.
	setTrayProgress(-1);

	// Ensure we exit when the window is closed.
	win.on('close', () => process.exit(0));

	if (process.env.NODE_ENV === 'development') {
		// Open DevTools if we're in debug mode.
		win.showDevTools();

		// Add a quick-reload keybinding.
		document.addEventListener('keydown', (e) => {
			if (e.key === 'F5')
				restartApplication();
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

	const manifest = nw.App.manifest;
	const cpus = os.cpus();

	// Append the application version to the title bar.
	document.title += ' v' + manifest.version;

	Log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
	Log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform(), os.arch(), cpus[0].model, cpus.length, filesize(os.freemem()), filesize(os.totalmem()));
	Log.write('INSTALL_PATH %s DATA_PATH %s', Constants.INSTALL_PATH, Constants.DATA_PATH);

	const app = createApp(App);

	// Register error handler for Vue errors.
	app.config.errorHandler = CrashHandler.handleVueError;

	// Register components.
	app.component('CheckboxList', ComponentCheckboxList);
	app.component('ContextMenu', ComponentContextMenu);
	app.component('DataTable', ComponentDataTable);
	app.component('FileField', ComponentFileField);
	app.component('ItemListBox', ComponentItemListBox);
	app.component('ListBox', ComponentListBox);
	app.component('ListBoxB', ComponentListBoxB);
	app.component('MapViewer', ComponentMapViewer);
	app.component('MenuButton', ComponentMenuButton);
	app.component('ModelViewer', ComponentModelViewer);
	app.component('ResizeLayer', ComponentResizeLayer);
	app.component('SliderComponent', ComponentSlider);

	app.mount('#container');
	window['state'] = state;

	// Load configuration.
	await Config.load();

	// Set-up default export directory if none configured.
	if (state.config.exportDirectory === '') {
		state.config.exportDirectory = path.join(os.homedir(), 'wow.export');
		Log.write('No export directory set, setting to %s', state.config.exportDirectory);
	}

	// Load cachesize, a file used to track the overall size of the cache directory
	// without having to calculate the real size before showing to users. Fast and reliable.
	fs.readFile(Constants.CACHE.SIZE, 'utf8').then(data => {
		state.cacheSize = Number(data) || 0;
	}).catch(() => {
		// File doesn't exist yet, don't error.
	}).finally(() => {
		let updateTimer: NodeJS.Timeout;

		// Create a watcher programmatically *after* assigning the initial value
		// to prevent a needless file write by triggering itself during init.
		watch(() => state.cacheSize, (newValue) => {
			// Clear any existing timer running.
			clearTimeout(updateTimer);

			// We buffer this call by SIZE_UPDATE_DELAY so that we're not writing
			// to the file constantly during heavy cache usage. Postponing until
			// next tick would not help due to async and potential IO/net delay.
			updateTimer = setTimeout(() => {
				fs.writeFile(Constants.CACHE.SIZE, newValue.toString(), 'utf8');
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
				setToast('info', 'A new update is available. You should update, it\'s probably really cool!', {
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

	const pings = Array<Promise<number | void>>();
	const regions = state.cdnRegions;
	const userRegion = state.config.sourceSelectUserRegion;

	// User has pre-selected a CDN, lock choice from changing.
	if (typeof userRegion === 'string')
		state.lockCDNRegion = true;

	// Iterate CDN regions and create data nodes.
	for (const region of Constants.PATCH.REGIONS) {
		const cdnURL: string = util.format(Constants.PATCH.HOST, region);
		const node: CDNRegion = reactive({ tag: region, url: cdnURL, delay: null });
		regions.push(node);

		// Mark this region as the selected one.
		if (region === userRegion || (typeof userRegion !== 'string' && region === Constants.PATCH.DEFAULT_REGION))
			state.selectedCDNRegion = node;

		// Run a rudimentary ping check for each CDN.
		pings.push(ping(cdnURL).then(ms => node.delay = ms).catch(e => {
			node.delay = -1;
			Log.write('Failed ping to %s: %s', cdnURL, e.message);
		}));
	}

	// Grab recent local installations from config.
	if (!Array.isArray(state.config.recentLocal))
		state.config.recentLocal = [];

	// Once all pings are resolved, pick the fastest.
	Promise.all(pings).then(() => {
		// CDN region choice is locked, do nothing.
		if (state.lockCDNRegion)
			return;

		const selectedRegion = state.selectedCDNRegion;
		for (const region of regions) {
			// Skip regions that don't have a valid ping.
			if (region.delay === null || region.delay < 0)
				continue;

			// Switch the selected region for the fastest one.
			if (region.delay < selectedRegion.delay)
				state.selectedCDNRegion = region;
		}
	});

	// Load the changelog when the user opens the screen.
	Events.on('screen:changelog', () => {
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
	setScreen('source-select');
})();