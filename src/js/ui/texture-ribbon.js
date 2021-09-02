/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const core = require('../core');
const listfile = require('../casc/listfile');

let _syncID = 0;

/**
 * Invoked when the texture ribbon element resizes.
 */
const onResize = (width) => {
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
const reset = () => {
	core.view.textureRibbonStack = [];
	core.view.textureRibbonPage = 0;
	core.view.contextNodeTextureRibbon = null;

	return ++_syncID;
};

/**
 * Set the file displayed in a given ribbon slot.
 * @param {number} slotIndex 
 * @param {number} fileDataID 
 * @param {number} syncID
 */
const setSlotFile = (slotIndex, fileDataID, syncID) => {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot) {
		slot.fileDataID = fileDataID;

		const fileName = listfile.getByID(fileDataID);
		slot.fileName = fileName;
		slot.displayName = path.basename(fileName, path.extname(fileName));
	}
};

/**
 * Set the render source for a given ribbon slot.
 * @param {number} slotIndex 
 * @param {string} src 
 * @param {number} syncID
 */
const setSlotSrc = (slotIndex, src, syncID) => {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot)
		slot.src = src;
};

/**
 * Add an empty slot to the texture ribbon.
 * @returns {number}
 */
const addSlot = () => {
	const stack = core.view.textureRibbonStack;
	const slotIndex = stack.length;

	stack.push({ fileDataID: 0, displayName: 'Empty', fileName: '', src: '' });
	return slotIndex;
};

module.exports = {
	reset,
	setSlotFile,
	setSlotSrc,
	onResize,
	addSlot
};