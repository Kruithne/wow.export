/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const path = require('path');
const fsp = require('fs').promises;
const { MPQArchive } = require('./mpq');
const log = require('../log');

class MPQInstall {
	constructor(directory) {
		this.directory = directory;
		this.archives = [];
		this.listfile = new Map(); // filename -> { archive_index, mpq_name }
	}

	close() {
		for (const { archive } of this.archives)
			archive.close();
	}

	async _scan_mpq_files(dir) {
		const entries = await fsp.readdir(dir, { withFileTypes: true });
		const results = [];

		for (const entry of entries) {
			const full_path = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				const sub_results = await this._scan_mpq_files(full_path);
				results.push(...sub_results);
			} else if (entry.name.toLowerCase().endsWith('.mpq')) {
				results.push(full_path);
			}
		}

		return results.sort();
	}

	async loadInstall(progress) {
		await progress.step('Scanning for MPQ Archives');

		const mpq_files = await this._scan_mpq_files(this.directory);

		if (mpq_files.length === 0)
			throw new Error('No MPQ archives found in directory');

		log.write('Found %d MPQ archives in %s', mpq_files.length, this.directory);

		await progress.step('Loading MPQ Archives');

		for (const mpq_path of mpq_files) {
			const archive = new MPQArchive(mpq_path);
			const info = archive.getInfo();
			const mpq_name = path.relative(this.directory, mpq_path);

			this.archives.push({
				name: mpq_name,
				archive,
			});

			log.write('Loaded %s: format v%d, %d files, %d hash entries, %d block entries',
				mpq_name, info.formatVersion, info.fileCount, info.hashTableEntries, info.blockTableEntries);

			for (const filename of archive.files) {
				this.listfile.set(filename.toLowerCase(), {
					archive_index: this.archives.length - 1,
					mpq_name: mpq_name
				});
			}
		}

		await progress.step('MPQ Archives Loaded');
		log.write('Total files in listfile: %d', this.listfile.size);
	}

	getFilesByExtension(extension) {
		const ext = extension.toLowerCase();
		const results = [];

		for (const [filename, data] of this.listfile) {
			if (filename.endsWith(ext))
				results.push(`${data.mpq_name}\\${filename}`);
		}

		return results;
	}

	getAllFiles() {
		const results = [];

		for (const [filename, data] of this.listfile)
			results.push(`${data.mpq_name}\\${filename}`);

		return results;
	}

	getFile(display_path) {
		let filename = display_path;

		if (display_path.includes('\\')) {
			const parts = display_path.split('\\');
			filename = parts.slice(1).join('\\');
		}

		const normalized = filename.toLowerCase();
		const data = this.listfile.get(normalized);

		if (data === undefined)
			return null;

		const { archive } = this.archives[data.archive_index];
		return archive.extractFile(filename);
	}

	getFileCount() {
		return this.listfile.size;
	}

	getArchiveCount() {
		return this.archives.length;
	}
}

module.exports = { MPQInstall };
