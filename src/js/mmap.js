/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const log = require('./log');
const mmap_native = require(path.join(process.cwd(), 'mmap.node'));

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
