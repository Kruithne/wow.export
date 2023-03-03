/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
export const win = nw.Window.get();

/**
 * Copies the given text to the system clipboard.
 * @param text - The text to copy to the clipboard
 */
export function copyToClipboard(text: string): void {
	nw.Clipboard.get().set(text, 'text');
}

/**
 * Sets the progress bar on the tray icon.
 * @param progress - A number between 0 and 1 or -1 to hide the progress bar.
 */
export function setTrayProgress(progress: number): void {
	win.setProgressBar(progress);
}