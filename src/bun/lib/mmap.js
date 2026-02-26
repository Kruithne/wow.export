import * as log from './log.js';

const virtual_files = new Set();

export const create_virtual_file = () => {
	const mmap_obj = {
		data: null,
		isMapped: false,
		lastError: null,

		mapFile(file_path) {
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
