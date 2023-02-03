import fs from 'node:fs';

import Events from './events';
import Constants from './constants';

let hasCrashed: boolean = false;

/** @returns The contents of the runtime log or a friendly error. */
function getRuntimeLog(): string {
	try {
		return fs.readFileSync(Constants.RUNTIME_LOG, 'utf8');
	} catch (e) {
		return 'Unable to obtain runtime log: ' + e.message;
	}
}

/**
 * Crash the application.
 * @param errorName - The name of the error that occurred.
 * @param errorText - The text of the error that occurred.
 */
function crashApplication(errorName: string, errorText: string): void {
	// We cannot crash the application if it has already crashed.
	if (hasCrashed)
		return;

	hasCrashed = true;

	// Replace the entire markup with just that from the <noscript> block.
	// This is to prevent user-interaction once the application has crashed.
	const errorMarkup = document.querySelector('noscript').innerHTML;
	const body = document.querySelector('body');

	body.innerHTML = errorMarkup;

	// Keep the logo, because that's cool.
	const logo = document.createElement('div');
	logo.setAttribute('id', 'logo-background');
	document.body.appendChild(logo);

	const setText = (id: string, text: string): string => document.querySelector(id).textContent = text;

	// Show build version/flavour/ID.
	const manifest = nw.App.manifest;
	setText('#crash-screen-version', 'v' + manifest.version);
	setText('#crash-screen-flavour', manifest.flavour);
	setText('#crash-screen-build', manifest.buildId);

	// Display our error name/text.
	setText('#crash-screen-text-code', errorName);
	setText('#crash-screen-text-message', errorText);

	// Display the runtime log.
	setText('#crash-screen-log', getRuntimeLog());

	Events.emit('application-crash');
}

/**
 * Handle an unhandled promise rejection.
 * @param error - The error that occurred.
 */
export function handleUnhandledRejection(error: Error): void {
	crashApplication('Unhandled Promise Rejection', error.message);
}

/**
 * Handle an uncaught exception.
 * @param error - The error that occurred.
 */
export function handleUncaughtException(error: Error): void {
	crashApplication('Uncaught Exception', error.message);
}

/**
 * Handle a Vue error.
 * @param error - The error that occurred.
 */
export function handleVueError(error: Error): void {
	crashApplication('Reactive State Error', error.message);
}

export default {
	handleUnhandledRejection,
	handleUncaughtException,
	handleVueError
};