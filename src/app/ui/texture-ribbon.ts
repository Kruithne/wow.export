/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import * as core from '../core';
import * as listfile from '../casc/listfile';

let _syncID: number = 0;

/**
 * Invoked when the texture ribbon element resizes.
 */
export const onResize = (width: number): void => {
	// Take the total available space of the texture ribbon element and reduce
	// it by the width of the next/previous buttons (30 each).
	width -= 60;

	// Divide the available space by the true size of the slot elements.
	// Slot = 64 width, 1 + 1 border, 5 + 5 margin.
	core.view.textureRibbonSlotCount = Math.floor(width / 76);
};

/**
 * Reset the texture ribbon.
 */
export const reset = (): number => {
	core.view.textureRibbonStack = [];
	core.view.textureRibbonPage = 0;
	core.view.contextMenus.nodeTextureRibbon = null;

	return ++_syncID;
};

/**
 * Set the file displayed in a given ribbon slot.
 * @param slotIndex
 * @param fileDataID
 * @param syncID
 */
export const setSlotFile = (slotIndex: number, fileDataID: number, syncID: number): void => {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot) {
		slot.fileDataID = fileDataID;

		const fileName = listfile.getByID(fileDataID) ?? fileDataID.toString();
		slot.fileName = fileName;
		slot.displayName = path.basename(fileName, path.extname(fileName));
	}
};

/**
 * Set the render source for a given ribbon slot.
 * @param slotIndex
 * @param src
 * @param syncID
 */
export const setSlotSrc = (slotIndex: number, src: string, syncID: number): void => {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot)
		slot.src = src;
};

/**
 * Add an empty slot to the texture ribbon.
 * @returns
 */
export const addSlot = (): number => {
	const stack = core.view.textureRibbonStack;
	const slotIndex = stack.length;

	stack.push({ fileDataID: 0, displayName: 'Empty', fileName: '', src: '' });
	return slotIndex;
};