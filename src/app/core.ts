/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { redraw } from './generics';
import { CDNRegion } from './ui/source-select'; // NIT: Better place to store this.

let toastTimer: number = -1; // Used by setToast() for TTL toast prompts.

// dropHandlers contains handlers for drag/drop support.
// Each item is an object defining .ext, .prompt() and .process().
const dropHandlers = [];

// loaders is an array of promises which need to be resolved as a
// step in the loading process, allowing components to initialize.
let loaders = [];

/**
 * Run an async function while preventing the user from starting others.
 * This is heavily used in UI to disable components during big tasks.
 * @param {function} func
 */
export const block = async (func) => {
	view.isBusy++;
	await func();
	view.isBusy--;
};

/**
 * Create a progress interface for easy status reporting.
 * @param {number} segments
 * @returns {Progress}
 */
export const createProgress = (segments: number = 1): any => { // NIT: Where does Progress come from?
	view.loadPct = 0;
	return {
		segWeight: 1 / segments,
		value: 0,
		step: async function(text: string) {
			this.value++;
			view.loadPct = Math.min(this.value * this.segWeight, 1);

			if (text)
				view.loadingProgress = text;

			await redraw();
		}
	};
};

/**
 * Hide the currently active toast prompt.
 * @param userCancel
 */
export const hideToast = (userCancel: boolean = false) => {
	// Cancel outstanding toast expiry timer.
	if (toastTimer > -1) {
		clearTimeout(toastTimer);
		toastTimer = -1;
	}

	view.toast = null;

	if (userCancel)
		events.emit('toast-cancelled');
};

/**
 * Display a toast message.
 * @param toastType - 'error', 'info', 'success', 'progress'
 * @param message
 * @param options
 * @param ttl - Time in milliseconds before removing the toast.
 * @param closable - If true, toast can manually be closed.
 */
export const setToast = (toastType: string, message: string, options: object|null = null, ttl: number = 10000, closable: boolean = true) => {
	view.toast = { type: toastType, message, options, closable };

	// Remove any outstanding toast timer we may have.
	clearTimeout(toastTimer);

	// Create a timer to remove this toast.
	if (ttl > -1)
		// toastTimer = setTimeout(hideToast, ttl); // NIT: This assignment seems bogus? Commented out and replaced without assignment below.
		setTimeout(hideToast, ttl);
};

/**
 * Open user-configured export directory with OS default.
 */
export const openExportDirectory = () => {
	nw.Shell.openItem(view.config.exportDirectory);
};

/**
 * Register a handler for file drops.
 * @param {object} handler
 */
export const registerDropHandler = (handler) => {
	// Ensure the extensions are all lower-case.
	handler.ext = handler.ext.map(e => e.toLowerCase());
	dropHandlers.push(handler);
};

/**
 * Get a drop handler for the given file path.
 * @param {string} file
 */
export const getDropHandler = (file) => {
	file = file.toLowerCase();

	for (const handler of dropHandlers) {
		for (const ext of handler.ext) {
			if (file.endsWith(ext))
				return handler;
		}
	}

	return null;
};

/**
 * Register a promise to be resolved during the last loading step.
 * @param {function} func
 */
export const registerLoadFunc = (func) => {
	loaders.push(func);
};

/**
 * Resolve all registered loader functions.
 */
export const runLoadFuncs = async () => {
	while (loaders.length > 0)
		await loaders.shift()();

	loaders = undefined;
};
