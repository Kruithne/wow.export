/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import util from 'node:util';

import Log from '../log';
import State from '../state';
import Events from '../events';

const TOAST_OPT_LOG = { 'View Log': (): void => Log.openRuntimeLog() };
//const TOAST_OPT_DIR = { 'Open Export Directory': () => State.openExportDirectory() };

export type ExportTexture = {
	matPathRelative: string;
	matPath: string;
	matName: string;
}

/**
 * ExportHelper is a unified way to provide feedback to the user and to
 * the logger about a generic export progress.
 * @class ExportHelper
 */
export default class ExportHelper {
	count: number;
	succeeded: number;
	unit: string;
	isFinished = false;
	currentTaskName: string;
	currentTaskMax = -1;
	currentTaskValue = -1;
	lastItem: string;

	/**
	 * Return an export path for the given file.
	 * @param file
	 */
	static getExportPath(file: string): string {
		// Remove whitespace due to MTL incompatibility for textures.
		if (State.state.config.removePathSpaces)
			file = file.replace(/\s/g, '');

		return path.normalize(path.join(State.state.config.exportDirectory, file));
	}

	/**
	 * Returns a relative path from the export directory to the given file.
	 * @param file
	 * @returns Relative path of given file
	 */
	static getRelativeExport(file: string): string {
		return path.relative(State.state.config.exportDirectory, file);
	}

	/**
	 * Takes the directory from fileA and combines it with the basename of fileB.
	 * @param fileA
	 * @param fileB
	 * @returns Combined directory from fileA and basename of fileB
	 */
	static replaceFile(fileA: string, fileB: string): string {
		return path.join(path.dirname(fileA), path.basename(fileB));
	}

	/**
	 * Replace an extension on a file path with another.
	 * @param file
	 * @param ext
	 * @returns File with replaced extension
	 */
	static replaceExtension(file: string, ext = ''): string {
		return path.join(path.dirname(file), path.basename(file, path.extname(file)) + ext);
	}

	/**
	 * Replace the base name of a file path, keeping the directory and extension.
	 * @param filePath
	 * @param fileName
	 * @returns File path but with basename of fileName
	 */
	static replaceBaseName(filePath: string, fileName: string): string {
		return path.join(path.dirname(filePath), fileName + path.extname(filePath));
	}

	/**
	 * Converts a win32 compatible path to a POSIX compatible path.
	 * @param str String with \ slashes
	 * @returns String with / slashes
	 */
	static win32ToPosix(str: string): string {
		// path module does not expose any decent conversion API, so simply
		// convert slashes like a cave-person and call it a day.
		return str.replaceAll('\\', '/');
	}

	/**
	 * Construct a new ExportHelper instance.
	 * @param count
	 * @param unit
	 */
	constructor(count: number, unit = 'item') {
		this.count = count;
		this.unit = unit;
	}

	/**
	 * How many items have failed to export.
	 * @returns Number of failed items
	 */
	get failed(): number {
		return this.count - this.succeeded;
	}

	/**
	 * Get the unit name formatted depending on plurality.
	 */
	get unitFormatted(): string {
		return this.count > 1 ? this.unit + 's' : this.unit;
	}

	/**
	 * Start the export.
	 */
	start(): void {
		this.succeeded = 0;
		this.isFinished = false;

		State.state.isBusy++;
		State.state.exportCancelled = false;

		Log.write('Starting export of %d %s items', this.count, this.unit);
		this.updateCurrentTask();

		Events.once('toast-cancelled', () => {
			if (!this.isFinished) {
				State.state.setToast('progress', 'Cancelling export, hold on...', null, -1, false);
				State.state.exportCancelled = true;
			}
		});
	}

	/**
	 * Returns true if the current export is cancelled. Also calls this.finish()
	 * as we can assume the export will now stop.
	 * @returns If exported is cancelled
	 */
	isCancelled(): boolean {
		if (State.state.exportCancelled) {
			this.finish();
			return true;
		}

		return false;
	}

	/**
	 * Finish the export.
	 * @param includeDirLink
	 */
	finish(includeDirLink = true): void {
		// Prevent duplicate calls to finish() in the event of user cancellation.
		if (this.isFinished)
			return;

		Log.write('Finished export (%d succeeded, %d failed)', this.succeeded, this.failed);

		if (this.succeeded === this.count) {
			// Everything succeeded.
			const lastExportPath = ExportHelper.getExportPath(path.dirname(this.lastItem));
			const toastOpt = { 'View in Explorer': () => nw.Shell.openItem(lastExportPath) };

			if (this.count > 1)
				State.state.setToast('success', util.format('Successfully exported %d %s.', this.count, this.unitFormatted), includeDirLink ? toastOpt : null, -1);
			else
				State.state.setToast('success', util.format('Successfully exported %s.', this.lastItem), includeDirLink ? toastOpt : null, -1);
		} else if (this.succeeded > 0) {
			// Partial success, not everything exported.
			const cancelled = State.state.exportCancelled;
			State.state.setToast('info', util.format('Export %s %d %s %s export.', cancelled ? 'cancelled, ' : 'complete, but', this.failed, this.unitFormatted, cancelled ? 'didn\'t' : 'failed to'), cancelled ? null : TOAST_OPT_LOG);
		} else {
			// Everything failed.
			if (State.state.exportCancelled)
				State.state.setToast('info', 'Export was cancelled by the user.', null);
			else
				State.state.setToast('error', util.format('Unable to export %s.', this.unitFormatted), TOAST_OPT_LOG, -1);
		}

		this.isFinished = true;
		State.state.isBusy--;
	}

	/**
	 * Set the current task name.
	 * @param name
	 */
	setCurrentTaskName(name: string): void {
		this.currentTaskName = name;
		this.updateCurrentTask();
	}

	/**
	 * Set the maximum value of the current task.
	 * @param max
	 */
	setCurrentTaskMax(max: number): void {
		this.currentTaskMax = max;
		this.updateCurrentTask();
	}

	/**
	 * Set the value of the current task.
	 * @param value
	 */
	setCurrentTaskValue(value: number): void {
		this.currentTaskValue = value;
		this.updateCurrentTask();
	}

	/**
	 * Clear the current progression task.
	 */
	clearCurrentTask(): void {
		this.currentTaskName = null;
		this.currentTaskMax = -1;
		this.currentTaskValue = -1;
		this.updateCurrentTask();
	}

	/**
	 * Update the current task progression.
	 */
	updateCurrentTask(): void {
		let exportProgress = util.format('Exporting %d / %d %s', this.succeeded, this.count, this.unitFormatted);

		if (this.currentTaskName !== null) {
			exportProgress += ' (Current task: ' + this.currentTaskName;
			if (this.currentTaskValue > -1 && this.currentTaskMax > -1)
				exportProgress += util.format(', %d / %d', this.currentTaskValue, this.currentTaskMax);

			exportProgress += ')';
		}

		State.state.setToast('progress', exportProgress, null, -1, true);
	}

	/**
	 * Mark exportation of an item.
	 * @param item
	 * @param state
	 * @param error
	 */
	mark(item: string, state: boolean, error: string | null = null): void {
		if (state) {
			Log.write('Successfully exported %s', item);
			this.lastItem = item;
			this.succeeded++;
		} else {
			Log.write('Failed to export %s (%s)', item, error);
		}

		this.updateCurrentTask();
	}
}