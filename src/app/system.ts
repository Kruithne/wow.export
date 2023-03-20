/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
export const win = nw.Window.get();

type ClipboardType = 'text' | 'png' | 'jpeg' | 'html' | 'rtf';

/**
 * Restarts the Chromium runtime.
 */
export function restartApplication(): void {
	chrome.runtime.reload();
}

/**
 * Copies the given text to the system clipboard.
 * @param text - The text to copy to the clipboard
 * @param type - The type of data to copy to the clipboard
 * @param raw - Whether to copy the data as raw data or not
 */
export function setClipboard(text: string, type: ClipboardType = 'text', raw: boolean = false): void {
	nw.Clipboard.get().set(text, type, raw);
}

/**
 * Sets the progress bar on the tray icon.
 * @param progress - A number between 0 and 1 or -1 to hide the progress bar.
 */
export function setTrayProgress(progress: number): void {
	win.setProgressBar(progress);
}

/**
 * Opens the given path in the system file browser.
 * @param path - The path to open in the system file browser.
 */
export function openShell(path: string): void {
	nw.Shell.openItem(path);
}