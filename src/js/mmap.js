/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const log = require('./log');
const fs = require('fs');

/**
 * Locate mmap.node native addon.
 *
 * On macOS, Bun inlines __dirname at bundle time as a hardcoded path from
 * the build machine's source tree. At runtime inside the .app bundle this
 * path is wrong, so we resolve relative to process.execPath instead.
 *
 * The search covers three cases:
 *   1. Next to the executable (Windows, Linux)
 *   2. In the main app bundle Resources/app.nw/src/ (macOS main process)
 *   3. Same as #2 but reached from a helper process deep in Frameworks/
 */
const resolve_mmap_path = () => {
	const execDir = path.dirname(process.execPath);
	const candidates = [
		path.join(execDir, 'mmap.node'),
	];

	// Walk up from execPath looking for a directory that contains
	// Contents/Resources/app.nw/src/mmap.node (the macOS app bundle).
	let dir = execDir;
	for (let i = 0; i < 15; i++) {
		candidates.push(path.join(dir, 'Contents', 'Resources', 'app.nw', 'src', 'mmap.node'));
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	for (const candidate of candidates) {
		try { if (fs.existsSync(candidate)) return candidate; } catch {}
	}

	throw new Error('mmap.node not found. Searched:\n' + candidates.join('\n'));
};

const mmap_native = require(resolve_mmap_path());

const virtual_files = new Set();

/**
 * create memory-mapped file object and track it for cleanup.
 * @returns {object} mmap object
 */
const create_virtual_file = () => {
	const mmap_obj = new mmap_native.MmapObject();
	virtual_files.add(mmap_obj);
	return mmap_obj;
};

/**
 * release all tracked memory-mapped files.
 * swallows errors to ensure all files are attempted.
 */
const release_virtual_files = () => {
	try {
		for (const mmap_obj of virtual_files) {
			try {
				if (mmap_obj.isMapped)
					mmap_obj.unmap();
			} catch (e) {
				// swallow individual unmap errors
			}
		}

		const count = virtual_files.size;
		virtual_files.clear();
		log.write('released %d memory-mapped files', count);
	} catch (e) {
		log.write('error during virtual file cleanup: %s', e.message);
	}
};

module.exports = {
	create_virtual_file,
	release_virtual_files
};
