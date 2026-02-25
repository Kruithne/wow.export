import fsp from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';

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
		// TODO: wire to export-helper.js migration
		// will iterate files, extract via casc, write to dir
		// sends export_progress messages during operation
		throw new Error('not implemented: export pipeline not yet migrated');
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
		// TODO: apply config.removePathSpaces, resolve against export dir
		throw new Error('not implemented: export path resolution');
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
