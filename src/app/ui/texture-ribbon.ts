/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';

import State from '../state';
import Listfile from '../casc/listfile';

let _syncID = 0;

export type TextureRibbonSlot = {
	fileDataID: number;
	displayName: string;
	fileName: string;
	src: string;
};

/** Invoked when the texture ribbon element resizes. */
export function onResize(width: number): void {
	// Take the total available space of the texture ribbon element and reduce
	// it by the width of the next/previous buttons (30 each).
	width -= 60;

	// Divide the available space by the true size of the slot elements.
	// Slot = 64 width, 1 + 1 border, 5 + 5 margin.
	State.textureRibbonSlotCount = Math.floor(width / 76);
}

/** Reset the texture ribbon. */
export function reset(): number {
	State.textureRibbonStack = [];
	State.textureRibbonPage = 0;
	State.contextMenus.nodeTextureRibbon = null;

	return ++_syncID;
}

/**
 * Set the file displayed in a given ribbon slot.
 * @param slotIndex
 * @param fileDataID
 * @param syncID
 */
export function setSlotFile(slotIndex: number, fileDataID: number, syncID: number): void {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = State.textureRibbonStack[slotIndex];
	if (slot) {
		slot.fileDataID = fileDataID;

		const fileName = Listfile.getByID(fileDataID) ?? fileDataID.toString();
		slot.fileName = fileName;
		slot.displayName = path.basename(fileName, path.extname(fileName));
	}
}

/**
 * Set the render source for a given ribbon slot.
 * @param slotIndex
 * @param src
 * @param syncID
 */
export function setSlotSrc(slotIndex: number, src: string, syncID: number): void {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = State.textureRibbonStack[slotIndex];
	if (slot)
		slot.src = src;
}

/**
 * Add an empty slot to the texture ribbon.
 * @returns
 */
export function addSlot(): number {
	const stack = State.textureRibbonStack;
	const slotIndex = stack.length;

	stack.push({ fileDataID: 0, displayName: 'Empty', fileName: '', src: '' });
	return slotIndex;
}

export default {
	onResize,
	reset,
	setSlotFile,
	setSlotSrc,
	addSlot
};