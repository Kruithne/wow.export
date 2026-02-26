import core from './core.js';
import log from './log.js';
import { fileExists } from './generics.js';

function dirname(p) {
	const idx = p.lastIndexOf('/');
	return idx === -1 ? '.' : p.substring(0, idx);
}

function basename(p, ext) {
	let base = p.substring(p.lastIndexOf('/') + 1);
	if (ext && base.endsWith(ext))
		base = base.substring(0, base.length - ext.length);

	return base;
}

function extname(p) {
	const base = p.substring(p.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return dot <= 0 ? '' : base.substring(dot);
}

class ExportHelper {
	static getExportPath(file) {
		if (core.view.config.removePathSpaces)
			file = file.replace(/\s/g, '');

		const dir = core.view.config.exportDirectory;
		return dir + '/' + file;
	}

	static getRelativeExport(file) {
		const dir = core.view.config.exportDirectory;
		if (file.startsWith(dir))
			return file.substring(dir.length + 1);

		return file;
	}

	static replaceFile(fileA, fileB) {
		return dirname(fileA) + '/' + basename(fileB);
	}

	static replaceExtension(file, ext = '') {
		const dir = dirname(file);
		const base = basename(file, extname(file));
		return dir + '/' + base + ext;
	}

	static replaceBaseName(filePath, fileName) {
		return dirname(filePath) + '/' + fileName + extname(filePath);
	}

	static win32ToPosix(str) {
		return str.replaceAll('\\', '/');
	}

	static sanitizeFilename(str) {
		return str.replace(/[\\/:*?"<>|]/g, '');
	}

	static async getIncrementalFilename(filePath) {
		if (!(await fileExists(filePath)))
			return filePath;

		const dir = dirname(filePath);
		const ext = extname(filePath);
		const base = basename(filePath, ext);

		let counter = 1;
		let new_path;

		do {
			new_path = dir + '/' + base + '_' + counter + ext;
			counter++;
		} while (await fileExists(new_path));

		return new_path;
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

		core.view.isBusy++;
		core.view.exportCancelled = false;

		log.write('Starting export of %d %s items', this.count, this.unit);
		this.updateCurrentTask();

		core.events.once('toast-cancelled', () => {
			if (!this.isFinished) {
				core.setToast('progress', 'Cancelling export, hold on...', null, -1, false);
				core.view.exportCancelled = true;
			}
		});
	}

	isCancelled() {
		if (core.view.exportCancelled) {
			this.finish();
			return true;
		}

		return false;
	}

	finish(include_dir_link = true) {
		if (this.isFinished)
			return;

		log.write('Finished export (%d succeeded, %d failed)', this.succeeded, this.failed);

		if (this.succeeded === this.count) {
			const last_export_path = ExportHelper.getExportPath(dirname(this.lastItem));
			const toast_opt = include_dir_link ? { 'View in Explorer': last_export_path } : null;

			if (this.count > 1)
				core.setToast('success', `Successfully exported ${this.count} ${this.unitFormatted}.`, toast_opt, -1);
			else
				core.setToast('success', `Successfully exported ${this.lastItem}.`, toast_opt, -1);
		} else if (this.succeeded > 0) {
			const cancelled = core.view.exportCancelled;
			core.setToast('info', `Export ${cancelled ? 'cancelled, ' : 'complete, but'} ${this.failed} ${this.unitFormatted} ${cancelled ? 'didn\'t' : 'failed to'} export.`, cancelled ? null : null);
		} else {
			if (core.view.exportCancelled)
				core.setToast('info', 'Export was cancelled by the user.', null);
			else
				core.setToast('error', `Unable to export ${this.unitFormatted}.`, null, -1);
		}

		this.isFinished = true;
		core.view.isBusy--;
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
		let progress = `Exporting ${this.succeeded} / ${this.count} ${this.unitFormatted}`;

		if (this.currentTaskName !== null) {
			progress += ' (Current task: ' + this.currentTaskName;
			if (this.currentTaskValue > -1 && this.currentTaskMax > -1)
				progress += `, ${this.currentTaskValue} / ${this.currentTaskMax}`;

			progress += ')';
		}

		core.setToast('progress', progress, null, -1, true);
	}

	mark(item, state, error, stack_trace = null) {
		if (state) {
			log.write('Successfully exported %s', item);
			this.lastItem = item;
			this.succeeded++;
		} else {
			log.write('Failed to export %s (%s)', item, error);

			if (stack_trace != null)
				console.log(stack_trace);
		}

		this.updateCurrentTask();
	}
}

export default ExportHelper;
