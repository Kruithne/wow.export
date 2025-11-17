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
					mpq_name: mpq_name,
					original_filename: filename
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
		const MPQ_FILE_DELETE_MARKER = 0x02000000;
		const results = [];

		for (const [filename, data] of this.listfile) {
			const { archive } = this.archives[data.archive_index];
			const hash_entry = archive.getHashTableEntry(data.original_filename);

			if (hash_entry) {
				const block_entry = archive.blockTable[hash_entry.blockTableIndex];

				// Skip files marked as deleted
				if (block_entry && (block_entry.flags & MPQ_FILE_DELETE_MARKER)) {
					continue;
				}
			}

			results.push(`${data.mpq_name}\\${filename}`);
		}

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

		if (data === undefined) {
			// try stripping more path components if the MPQ name has multiple parts
			if (display_path.includes('\\')) {
				const parts = display_path.split('\\');
				const mpq_parts = data?.mpq_name?.split('\\').length || 0;

				// try looking up with just the filename part (skip MPQ name components)
				for (let i = 1; i < parts.length; i++) {
					const test_filename = parts.slice(i).join('\\').toLowerCase();
					const test_data = this.listfile.get(test_filename);
					if (test_data !== undefined) {
						const { archive } = this.archives[test_data.archive_index];
						return archive.extractFile(test_data.original_filename);
					}
				}
			}

			return null;
		}

		const { archive } = this.archives[data.archive_index];
		return archive.extractFile(data.original_filename);
	}

	getFileCount() {
		return this.listfile.size;
	}

	getArchiveCount() {
		return this.archives.length;
	}
}

module.exports = { MPQInstall };
