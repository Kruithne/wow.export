/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

// This is the main entry point for the application. This context/scope will be mixed with
// the browser context, so everything exposed here will be accessible from the browser
// and vice-versa.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { win } from './nwjs';

import Updater from './updater';
import Blender from './blender';
import ExternalLinks from './external-links';
import Constants from './constants';
import Log from './log';
import Config from './config';
import TactKeys from './casc/tact-keys';
import { state } from './core';
import Events from './events';
import CrashHandler from './crash-handler';

import { createApp } from 'vue';
import { LocaleFlags } from './casc/locale-flags';
import { filesize, formatPlaybackSeconds } from './generics';

import * as TextureRibbon from './ui/texture-ribbon';

// Import UI modules as side-effects.
import './ui/source-select';
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
	// Prevent files from being dropped onto the window. These are over-written
	// later but we disable here to prevent them working if init fails.
	window.ondragover = (e: DragEvent): boolean => {
		e.preventDefault(); return false;
	};
	window.ondrop = (e: DragEvent): boolean => {
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

	// Add a global event handler for the 'copy-to-clipboard' event.
	Events.on('copy-to-clipboard', (text: string) => {
		nw.Clipboard.get().set(text, 'text');
	});

	const manifest = nw.App.manifest;
	const cpus = os.cpus();

	Log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
	Log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform(), os.arch(), cpus[0].model, cpus.length, filesize(os.freemem()), filesize(os.totalmem()));
	Log.write('INSTALL_PATH %s DATA_PATH %s', Constants.INSTALL_PATH, Constants.DATA_PATH);

	const app = createApp({
		el: '#container',

		computed: {
			/**
			 * Returns true if the export directory contains spaces.
			 * @returns {boolean}
			 */
			isExportPathConcerning: function(): boolean {
				return !!this.config?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns true if the editing config directory contains spaces.
			 * @returns {boolean}
			 */
			isEditExportPathConcerning: function(): boolean {
				return !!this.configEdit?.exportDirectory?.match(/\s/g);
			},

			/**
			 * Returns the location of the last export manifest.
			 * @returns {string}
			 */
			lastExportPath: function(): string {
				if (this.config.lastExportFile.length > 0)
					return this.config.lastExportFile;

				return Constants.LAST_EXPORT;
			},

			/**
			 * Returns the default location of the last export manifest.
			 * @returns Default location of the last export manifest
			 */
			lastExportPathDefault: function(): string {
				return Constants.LAST_EXPORT;
			},

			/**
			 * Returns the currently 'active' screen, which is first on the stack.
			 */
			screen: function() {
				return this.screenStack[0];
			},

			/**
			 * Returns the cache size formatted as a file size.
			 */
			cacheSizeFormatted: function() {
				return filesize(this.cacheSize);
			},

			/**
			 * Returns an Array of available locale keys.
			 */
			availableLocaleKeys: function() {
				const flags = new Map<string, number>;
				for (const [key, value] of Object.entries(LocaleFlags)) {
					if (Number(key) >= 0)
						continue;

					flags.set(key, Number(value));
				}

				return Array.from(flags.keys()).map(e => {
					return { label: e, value: flags.get(e) };
				});
			},

			/**
			 * Return the locale key for the configured CASC locale.
			 */
			selectedLocaleKey: function() {
				return this.config.cascLocale;
			},

			/**
			 * Return the formatted duration of the selected track on the sound player.
			 */
			soundPlayerDurationFormatted: function() {
				return formatPlaybackSeconds(this.soundPlayerDuration);
			},

			/**
			 * Return the formatted current seek of the selected track on the sound player.
			 */
			soundPlayerSeekFormatted: function() {
				return formatPlaybackSeconds(this.soundPlayerSeek * this.soundPlayerDuration);
			},

			/**
			 * Returns the maximum amount of pages needed for the texture ribbon.
			 * @returns {number}
			 */
			textureRibbonMaxPages: function(): number {
				return Math.ceil(this.textureRibbonStack.length / this.textureRibbonSlotCount);
			},

			/**
			 * Returns the texture ribbon stack array subject to paging.
			 * @returns {Array}
			 */
			textureRibbonDisplay: function(): Array<TextureRibbon.TextureRibbonSlot> {
				const startIndex = this.textureRibbonPage * this.textureRibbonSlotCount;
				return this.textureRibbonStack.slice(startIndex, startIndex + this.textureRibbonSlotCount);
			}
		},

		watch: {
			/**
			 * Invoked when the active 'screen' is changed.
			 * @param {string} val
			 */
			screen: function(val: string) {
				Events.emit('screen-' + val);
			},

			/**
			 * Invoked when the active loading percentage is changed.
			 * @param val
			 */
			loadPct: function(val: number) {
				nw.Window.get().setProgressBar(val);
			},

			/**
			 * Invoked when the core CASC instance is changed.
			 */
			casc: function() {
				Events.emit('casc-source-changed');
			}
		},
	});

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

	//const state = defineComponent(app.mount('#container'));
	//state = state;

	app.mount('#container');

	window['state'] = state;

	// Load configuration.
	await Config.load();

	// Emit state-ready event and await all listeners.
	await Events.emitAndAwait('state-ready', state);

	// Set-up default export directory if none configured.
	if (state.config.exportDirectory === '') {
		state.config.exportDirectory = path.join(os.homedir(), 'wow.export');
		Log.write('No export directory set, setting to %s', state.config.exportDirectory);
	}

	// Set-up proper drag/drop handlers.
	let dropStack = 0;
	window.ondragenter = (e: DragEvent): boolean => {
		e.preventDefault();

		// Converting local files while busy shouldn't end badly, but it seems
		// weird to let people do this on loading screens.
		if (state.isBusy)
			return false;

		dropStack++;

		// We're already showing a prompt, don't re-process it.
		if (state.fileDropPrompt !== null)
			return false;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath: string = (files[0] as unknown as NWFile).path;
			const handler = state.getDropHandler(firstFilePath);

			if (handler) {
				let count = 0;
				for (const file of files) {
					const check = file.name.toLowerCase();
					if (handler.ext.some((ext: string) => check.endsWith(ext)))
						count++;
				}

				if (count > 0)
					state.fileDropPrompt = handler.prompt(count);
			} else {
				state.fileDropPrompt = 'That file cannot be converted.';
			}
		}

		return false;
	};

	window.ondrop = (e: DragEvent): boolean => {
		e.preventDefault();
		state.fileDropPrompt = null;

		const files = e.dataTransfer.files;
		if (files.length > 0) {
			// See comments on NWFile interface above.
			const firstFilePath = (files[0] as unknown as NWFile).path;
			const handler = state.getDropHandler(firstFilePath);

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

	window.ondragleave = (e: DragEvent): void => {
		e.preventDefault();

		// Window drag events trigger for all elements. Ensure that there is currently
		// nothing being dragged once the dropStack is empty.
		dropStack--;
		if (dropStack === 0)
			state.fileDropPrompt = null;
	};

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
		state.$watch('cacheSize', function(nv: number) {
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
				state.setToast('info', 'A new update is available. You should update, it\'s probably really cool!', {
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
	state.setScreen('source-select');
})();