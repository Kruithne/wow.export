import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function to_base64(buf) {
	return Buffer.from(buf).toString('base64');
}

export const filesystem_handlers = {
	async fs_read_file({ path: file_path, offset, length }) {
		if (offset !== undefined && length !== undefined) {
			const fh = await fsp.open(file_path, 'r');
			const buf = Buffer.alloc(length);
			await fh.read(buf, 0, length, offset);
			await fh.close();
			return to_base64(buf);
		}

		const buf = await fsp.readFile(file_path);
		return to_base64(buf);
	},

	async fs_write_file({ path: file_path, data, encoding }) {
		const buf = Buffer.from(data, 'base64');
		await fsp.writeFile(file_path, buf);
	},

	async fs_write_text({ path: file_path, text, encoding }) {
		await fsp.writeFile(file_path, text, encoding ?? 'utf8');
	},

	async fs_mkdir({ path: dir_path }) {
		await fsp.mkdir(dir_path, { recursive: true });
	},

	async fs_exists({ path: file_path }) {
		try {
			await fsp.access(file_path);
			return true;
		} catch {
			return false;
		}
	},

	async fs_readdir({ path: dir_path }) {
		return await fsp.readdir(dir_path);
	},

	async fs_stat({ path: file_path }) {
		const stat = await fsp.stat(file_path);
		return { size: stat.size, mtime: stat.mtimeMs };
	},

	async fs_delete_dir({ path: dir_path }) {
		let freed = 0;

		const walk = async (dir) => {
			const entries = await fsp.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
					await fsp.rmdir(full);
				} else {
					const stat = await fsp.stat(full);
					freed += stat.size;
					await fsp.unlink(full);
				}
			}
		};

		await walk(dir_path);
		await fsp.rmdir(dir_path).catch(() => {});
		return { freed };
	},

	async fs_is_writable({ path: dir_path }) {
		try {
			const test_file = path.join(dir_path, '.write_test_' + Date.now());
			await fsp.writeFile(test_file, '');
			await fsp.unlink(test_file);
			return true;
		} catch {
			return false;
		}
	},

	async fs_file_hash({ path: file_path, algorithm, encoding }) {
		const data = await fsp.readFile(file_path);
		return crypto.createHash(algorithm).update(data).digest(encoding);
	},

	async fs_hash_data({ data, algorithm, encoding }) {
		const buf = Buffer.from(data, 'base64');
		return crypto.createHash(algorithm).update(buf).digest(encoding ?? 'hex');
	},

	async fs_readdir_with_types({ path: dir_path }) {
		const entries = await fsp.readdir(dir_path, { withFileTypes: true });
		return entries.map(e => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
	},

	async fs_copy_file({ src, dest }) {
		await fsp.copyFile(src, dest);
	},

	async fs_unlink({ path: file_path }) {
		await fsp.unlink(file_path);
	},

	async fs_access({ path: file_path }) {
		try {
			await fsp.access(file_path);
			return true;
		} catch {
			return false;
		}
	},

	async fs_read_json({ path: file_path, strip_comments }) {
		try {
			let text = await fsp.readFile(file_path, 'utf8');
			if (strip_comments)
				text = text.replace(/^\s*\/\/.*$/gm, '');

			return JSON.parse(text);
		} catch {
			return null;
		}
	},

	async fs_write_json({ path: file_path, data }) {
		await fsp.writeFile(file_path, JSON.stringify(data, null, '\t'), 'utf8');
	},
};
