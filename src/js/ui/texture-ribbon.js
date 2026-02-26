/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import core from '../core.js';
import { listfile } from '../../views/main/rpc.js';

let _syncID = 0;

/**
 * Extract the base name from a file path, without extension.
 * @param {string} file_path
 * @returns {string}
 */
const get_display_name = (file_path) => {
	const last_slash = file_path.lastIndexOf('/');
	const base = last_slash === -1 ? file_path : file_path.substring(last_slash + 1);
	const dot = base.lastIndexOf('.');
	return dot === -1 ? base : base.substring(0, dot);
};

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
	core.view.contextMenus.nodeTextureRibbon = null;

	return ++_syncID;
};

/**
 * Set the file displayed in a given ribbon slot.
 * @param {number} slotIndex
 * @param {number} fileDataID
 * @param {number} syncID
 */
const setSlotFile = async (slotIndex, fileDataID, syncID) => {
	// Only accept data from the latest preparation.
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot) {
		slot.fileDataID = fileDataID;

		const fileName = (await listfile.getByID(fileDataID)) ?? fileDataID.toString();
		slot.fileName = fileName;
		slot.displayName = get_display_name(fileName);
	}
};

/**
 * Set the file displayed in a given ribbon slot (legacy - uses file path instead of fileDataID).
 * @param {number} slotIndex
 * @param {string} filePath
 * @param {number} syncID
 */
const setSlotFileLegacy = (slotIndex, filePath, syncID) => {
	if (syncID !== _syncID)
		return;

	const slot = core.view.textureRibbonStack[slotIndex];
	if (slot) {
		slot.fileDataID = 0;
		slot.fileName = filePath;
		slot.displayName = get_display_name(filePath);
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

export default {
	reset,
	setSlotFile,
	setSlotFileLegacy,
	setSlotSrc,
	onResize,
	addSlot
};
