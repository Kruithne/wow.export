/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

/**
 * Copies the given text to the system clipboard.
 * @param text - The text to copy to the clipboard
 */
export function copyToClipboard(text: string): void {
	nw.Clipboard.get().set(text, 'text');
}