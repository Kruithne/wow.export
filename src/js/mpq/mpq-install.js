/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import { MPQArchive } from './mpq.js';
import { detect_build_version } from './build-version.js';
import log from '../log.js';

class MPQInstall {
	constructor(directory) {
		this.directory = directory;
		this.archives = [];
		this.listfile = new Map(); // filename -> { archive_index, mpq_name }
		this.build_id = null;
	}

	close() {
		for (const { archive } of this.archives)
			archive.close();
	}

	async _scan_mpq_files(dir) {
		const fsp = await import('fs').then(m => m.promises);
		const entries = await fsp.readdir(dir, { withFileTypes: true });
		const results = [];

		for (const entry of entries) {
			const full_path = dir + '/' + entry.name;

			if (entry.isDirectory()) {
				const sub_results = await this._scan_mpq_files(full_path);
				results.push(...sub_results);
			} else if (entry.name.toLowerCase().endsWith('.mpq')) {
				results.push(full_path);
			}
		}

		return results.sort();
	}

	async loadInstall() {
		const { default: core } = await import('../core.js');
		await core.progressLoadingScreen('Scanning for MPQ Archives');

		const mpq_files = await this._scan_mpq_files(this.directory);

		if (mpq_files.length === 0)
			throw new Error('No MPQ archives found in directory');

		log.write(`Found ${mpq_files.length} MPQ archives in ${this.directory}`);

		await core.progressLoadingScreen('Loading MPQ Archives');

		for (const mpq_path of mpq_files) {
			const archive = new MPQArchive(mpq_path);
			const info = archive.getInfo();
			const mpq_name = mpq_path.startsWith(this.directory) ? mpq_path.slice(this.directory.length).replace(/^[\\/]/, '') : mpq_path;

			this.archives.push({
				name: mpq_name,
				archive,
			});

			log.write(`Loaded ${mpq_name}: format v${info.formatVersion}, ${info.fileCount} files, ${info.hashTableEntries} hash entries, ${info.blockTableEntries} block entries`);

			for (const filename of archive.files) {
				this.listfile.set(filename.toLowerCase(), {
					archive_index: this.archives.length - 1,
					mpq_name: mpq_name,
					original_filename: filename
				});
			}
		}

		await core.progressLoadingScreen('MPQ Archives Loaded');
		log.write(`Total files in listfile: ${this.listfile.size}`);

		// detect build version
		const mpq_names = this.archives.map(a => a.name);
		this.build_id = detect_build_version(this.directory, mpq_names);
		log.write(`Using build version: ${this.build_id}`);
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
		// normalize path separators (some files use forward slashes)
		const normalized_path = display_path.replace(/\//g, '\\');

		// first try direct lookup (for paths without mpq prefix like texture references)
		const direct_normalized = normalized_path.toLowerCase();
		const direct_data = this.listfile.get(direct_normalized);

		if (direct_data !== undefined) {
			const { archive } = this.archives[direct_data.archive_index];
			return archive.extractFile(direct_data.original_filename);
		}

		// try stripping mpq name prefix (for display paths like "patch.mpq\Creature\...")
		if (normalized_path.includes('\\')) {
			const parts = normalized_path.split('\\');

			// try progressively stripping path components
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

	getFileCount() {
		return this.listfile.size;
	}

	getArchiveCount() {
		return this.archives.length;
	}
}

export { MPQInstall };
