import path from 'node:path';
import util from 'node:util';
import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import * as generics from '../lib/generics.js';

const TOAST_OPT_LOG = null;

class ExportHelper {
	static getExportPath(file) {
		if (core.get_config('removePathSpaces'))
			file = file.replace(/\s/g, '');

		return path.normalize(path.join(core.get_config('exportDirectory'), file));
	}

	static getRelativeExport(file) {
		return path.relative(core.get_config('exportDirectory'), file);
	}

	static replaceFile(fileA, fileB) {
		return path.join(path.dirname(fileA), path.basename(fileB));
	}

	static replaceExtension(file, ext = '') {
		return path.join(path.dirname(file), path.basename(file, path.extname(file)) + ext);
	}

	static replaceBaseName(filePath, fileName) {
		return path.join(path.dirname(filePath), fileName + path.extname(filePath));
	}

	static win32ToPosix(str) {
		return str.replaceAll('\\', '/');
	}

	static sanitizeFilename(str) {
		return str.replace(/[\\/:*?"<>|]/g, '');
	}

	static async getIncrementalFilename(filePath) {
		if (!(await generics.fileExists(filePath)))
			return filePath;

		const dir = path.dirname(filePath);
		const ext = path.extname(filePath);
		const basename = path.basename(filePath, ext);

		let counter = 1;
		let newPath;

		do {
			newPath = path.join(dir, `${basename}_${counter}${ext}`);
			counter++;
		} while (await generics.fileExists(newPath));

		return newPath;
	}

	constructor(count, unit = 'item') {
		this.count = count;
		this.unit = unit;
		this.isFinished = false;

		this.currentTaskName = null;
		this.currentTaskMax = -1;
		this.currentTaskValue = -1;
	}

	get failed() {
		return this.count - this.succeeded;
	}

	get unitFormatted() {
		return this.count > 1 ? this.unit + 's' : this.unit;
	}

	start() {
		this.succeeded = 0;
		this.isFinished = false;

		core.increment_busy();
		core.set_export_cancelled(false);

		log.write('Starting export of %d %s items', this.count, this.unit);
		this.updateCurrentTask();
	}

	isCancelled() {
		if (core.get_export_cancelled()) {
			this.finish();
			return true;
		}

		return false;
	}

	finish(includeDirLink = true) {
		if (this.isFinished)
			return;

		log.write('Finished export (%d succeeded, %d failed)', this.succeeded, this.failed);

		if (this.succeeded === this.count) {
			const lastExportPath = ExportHelper.getExportPath(path.dirname(this.lastItem));
			const toastOpt = includeDirLink ? { 'View in Explorer': lastExportPath } : null;

			if (this.count > 1)
				core.set_toast('success', util.format('Successfully exported %d %s.', this.count, this.unitFormatted), toastOpt, -1);
			else
				core.set_toast('success', util.format('Successfully exported %s.', this.lastItem), toastOpt, -1);
		} else if (this.succeeded > 0) {
			const cancelled = core.get_export_cancelled();
			core.set_toast('info', util.format('Export %s %d %s %s export.', cancelled ? 'cancelled, ' : 'complete, but', this.failed, this.unitFormatted, cancelled ? 'didn\'t' : 'failed to'), cancelled ? null : TOAST_OPT_LOG);
		} else {
			if (core.get_export_cancelled())
				core.set_toast('info', 'Export was cancelled by the user.', null);
			else
				core.set_toast('error', util.format('Unable to export %s.', this.unitFormatted), TOAST_OPT_LOG, -1);
		}

		this.isFinished = true;
		core.decrement_busy();
	}

	setCurrentTaskName(name) {
		this.currentTaskName = name;
		this.updateCurrentTask();
	}

	setCurrentTaskMax(max) {
		this.currentTaskMax = max;
		this.updateCurrentTask();
	}

	setCurrentTaskValue(value) {
		this.currentTaskValue = value;
		this.updateCurrentTask();
	}

	clearCurrentTask() {
		this.currentTaskName = null;
		this.currentTaskMax = -1;
		this.currentTaskValue = -1;
		this.updateCurrentTask();
	}

	updateCurrentTask() {
		let exportProgress = util.format('Exporting %d / %d %s', this.succeeded, this.count, this.unitFormatted);

		if (this.currentTaskName !== null) {
			exportProgress += ' (Current task: ' + this.currentTaskName;
			if (this.currentTaskValue > -1 && this.currentTaskMax > -1)
				exportProgress += util.format(', %d / %d', this.currentTaskValue, this.currentTaskMax);

			exportProgress += ')';
		}

		core.set_toast('progress', exportProgress, null, -1, true);
	}

	mark(item, state, error, stackTrace = null) {
		if (state) {
			log.write('Successfully exported %s', item);
			this.lastItem = item;
			this.succeeded++;
		} else {
			log.write('Failed to export %s (%s)', item, error);

			if (stackTrace != null)
				console.log(stackTrace);
		}

		this.updateCurrentTask();
	}
}

export default ExportHelper;
