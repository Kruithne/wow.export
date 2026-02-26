/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

/**
 * Process a null-terminated string block.
 * @param {BufferWrapped} data
 * @param {number} chunkSize 
 */
const ReadStringBlock = (data, chunkSize) => {
	const chunk = data.readBuffer(chunkSize, false);
	const entries = {};

	let readOfs = 0;
	for (let i = 0; i < chunkSize; i++) {
		if (chunk[i] === 0x0) {
			// Skip padding bytes.
			if (readOfs === i) {
				readOfs += 1;
				continue;
			}
			
			entries[readOfs] = chunk.toString('utf8', readOfs, i).replace(/\0/g, '');
			readOfs = i + 1;
		}
	}

	return entries;
}

export { ReadStringBlock };