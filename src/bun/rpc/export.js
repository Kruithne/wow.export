import fsp from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import ExportHelper from '../casc/export-helper.js';
import * as core from '../lib/core.js';

let _rpc = null;
let _log_stream = null;
let _log_path = null;

export function init_export(paths, rpc) {
	_rpc = rpc;
	_log_path = paths.log;
}

function ensure_log_stream() {
	if (_log_stream || !_log_path)
		return;

	_log_stream = fs.createWriteStream(_log_path, { flags: 'a', encoding: 'utf8' });
}

export const export_handlers = {
	async export_files({ files, dir, format }) {
		const helper = new ExportHelper(files.length, 'file');
		helper.start();

		const casc = core.get_casc();
		if (!casc) {
			helper.finish();
			throw new Error('no CASC source loaded');
		}

		for (const file of files) {
			if (helper.isCancelled())
				break;

			try {
				const data = await casc.getFile(file.id);
				if (data) {
					data.processAllBlocks?.();
					const out_path = ExportHelper.getExportPath(file.name || ('unknown/' + file.id));
					await data.writeToFile(out_path);
					helper.mark(file.name || String(file.id), true);
				} else {
					helper.mark(file.name || String(file.id), false, 'file not found in CASC');
				}
			} catch (e) {
				helper.mark(file.name || String(file.id), false, e.message);
			}
		}

		helper.finish();
		return { succeeded: helper.succeeded, failed: helper.failed };
	},

	async export_raw({ data, path: file_path }) {
		const dir = path.dirname(file_path);
		await fsp.mkdir(dir, { recursive: true });

		const buf = Buffer.from(data, 'base64');
		await fsp.writeFile(file_path, buf);
	},

	async export_text({ text, path: file_path }) {
		const dir = path.dirname(file_path);
		await fsp.mkdir(dir, { recursive: true });
		await fsp.writeFile(file_path, text, 'utf8');
	},

	async export_get_path({ file }) {
		return ExportHelper.getExportPath(file);
	},

	async export_get_incremental({ path: file_path }) {
		const ext = path.extname(file_path);
		const base = file_path.slice(0, -ext.length);

		let counter = 0;
		let candidate = file_path;

		while (true) {
			try {
				await fsp.access(candidate);
				counter++;
				candidate = `${base}_${counter}${ext}`;
			} catch {
				return candidate;
			}
		}
	},
};

export const log_handlers = {
	async log_get_path() {
		return _log_path ?? '';
	},

	async log_open() {
		if (_log_path) {
			const { Utils } = await import('electrobun/bun');
			await Utils.openPath(_log_path);
		}
	},
};

// bun-side message handler: view sends log_write messages
export function handle_log_write({ level, message, args }) {
	ensure_log_stream();

	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] [${level}] ${message}${args?.length ? ' ' + JSON.stringify(args) : ''}\n`;

	if (_log_stream)
		_log_stream.write(line);
}
