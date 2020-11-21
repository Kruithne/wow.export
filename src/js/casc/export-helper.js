/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const util = require('util');
const core = require('../core');
const log = require('../log');

const TOAST_OPT_LOG = { 'View Log': () => log.openRuntimeLog() };
//const TOAST_OPT_DIR = { 'Open Export Directory': () => core.openExportDirectory() };

/**
 * ExportHelper is a unified way to provide feedback to the user and to
 * the logger about a generic export progress.
 * @class ExportHelper
 */
class ExportHelper {
	/**
	 * Return an export path for the given file.
	 * @param {string} file 
	 */
	static getExportPath(file) {
		// Remove whitespace due to MTL incompatibility for textures.
		if (core.view.config.removePathSpaces)
			file = file.replace(/\s/g, '');

		return path.normalize(path.join(core.view.config.exportDirectory, file));
	}

	/**
	 * Takes the directory from fileA and combines it with the basename of fileB.
	 * @param {string} fileA 
	 * @param {string} fileB 
	 */
	static replaceFile(fileA, fileB) {
		return path.join(path.dirname(fileA), path.basename(fileB));
	}

	/**
	 * Replace an extension on a file path with another.
	 * @param {string} file 
	 * @param {string} ext 
	 */
	static replaceExtension(file, ext = '') {
		return path.join(path.dirname(file), path.basename(file, path.extname(file)) + ext);
	}

	/**
	 * Construct a new ExportHelper instance.
	 * @param {number} count 
	 * @param {string} unit 
	 */
	constructor(count, unit = 'item') {
		this.count = count;
		this.unit = unit;
	}

	/**
	 * How many items have failed to export.
	 * @returns {number}
	 */
	get failed() {
		return this.count - this.succeeded;
	}

	/**
	 * Get the unit name formatted depending on plurality.
	 */
	get unitFormatted() {
		return this.count > 1 ? this.unit + 's' : this.unit;
	}

	/**
	 * Start the export.
	 */
	start() {
		this.succeeded = 0;
		core.view.isBusy++;

		log.write('Starting export of %d %s items', this.count, this.unit);
		core.setToast('progress', util.format('Exporting %d %s, please wait...', this.count, this.unitFormatted), null, -1, false);
	}

	/**
	 * Finish the export.
	 * @param {boolean} includeDirLink 
	 */
	finish(includeDirLink = true) {
		log.write('Finished export (%d succeeded, %d failed)', this.succeeded, this.failed);

		if (this.succeeded === this.count) {
			// Everything succeeded.
			const lastExportPath = ExportHelper.getExportPath(path.dirname(this.lastItem));
			const toastOpt = { 'View in Explorer': () => nw.Shell.openItem(lastExportPath) };

			if (this.count > 1)
				core.setToast('success', util.format('Successfully exported %d %s.', this.count, this.unitFormatted), includeDirLink ? toastOpt : null);
			else
				core.setToast('success', util.format('Successfully exported %s.', this.lastItem), includeDirLink ? toastOpt : null);
		} else if (this.succeeded > 0) {
			// Partial success, not everything exported.
			core.setToast('info', util.format('Export complete, but %d %s failed to export.', this.failed, this.unitFormatted), TOAST_OPT_LOG);
		} else {
			// Everything failed.
			core.setToast('error', util.format('Unable to export %s.', this.unitFormatted), TOAST_OPT_LOG);
		}

		core.view.isBusy--;
	}

	/**
	 * Mark exportation of an item.
	 * @param {string} item
	 * @param {boolean} state
	 * @param {string} error
	 */
	mark(item, state, error) {
		if (state) {
			log.write('Successfully exported %s', item);
			this.lastItem = item;
			this.succeeded++;
		} else {
			log.write('Failed to export %s (%s)', item, error);
		}
	}
}

module.exports = ExportHelper;