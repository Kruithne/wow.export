import path from 'node:path';
import fs from 'node:fs';
import * as log from './log.js';

const virtual_files = new Set();
let mmap_native = null;
let use_bun_mmap = false;

if (process.platform !== 'win32') {
	use_bun_mmap = true;
} else {
	try {
		const install_path = path.dirname(process.execPath);
		mmap_native = require(path.join(install_path, 'mmap.node'));
	} catch {
		try {
			mmap_native = require(path.resolve('node_addons/mmap/build/Release/mmap.node'));
		} catch {
			log.write('mmap: native module not available, falling back to file reads');
		}
	}
}

export const create_virtual_file = () => {
	if (use_bun_mmap) {
		const mmap_obj = {
			data: null,
			isMapped: false,
			lastError: null,

			mapFile(file_path, opts) {
				try {
					mmap_obj.data = Bun.mmap(file_path);
					mmap_obj.isMapped = true;
					return true;
				} catch (e) {
					mmap_obj.lastError = e.message;
					return false;
				}
			},

			unmap() {
				mmap_obj.data = null;
				mmap_obj.isMapped = false;
			}
		};

		virtual_files.add(mmap_obj);
		return mmap_obj;
	}

	if (mmap_native) {
		const mmap_obj = new mmap_native.MmapObject();
		virtual_files.add(mmap_obj);
		return mmap_obj;
	}

	const mmap_obj = {
		data: null,
		isMapped: false,
		lastError: null,

		mapFile(file_path, opts) {
			try {
				const buf = fs.readFileSync(file_path);
				mmap_obj.data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
				mmap_obj.isMapped = true;
				return true;
			} catch (e) {
				mmap_obj.lastError = e.message;
				return false;
			}
		},

		unmap() {
			mmap_obj.data = null;
			mmap_obj.isMapped = false;
		}
	};

	virtual_files.add(mmap_obj);
	return mmap_obj;
};

export const release_virtual_files = () => {
	try {
		for (const mmap_obj of virtual_files) {
			try {
				if (mmap_obj.isMapped)
					mmap_obj.unmap();
			} catch {
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
