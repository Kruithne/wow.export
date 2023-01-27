/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const table = Array(256);

(() => {
	for (let i = 0; i < 256; i++) {
		let current = i;
		for (let j = 0; j < 8; j++) {
			if (current & 1)
				current = 0xEDB88320 ^ (current >>> 1);
			else
				current = current >>> 1;
		}

		table[i] = current;
	}
})();

/**
 * Calculate the CRC32 value of a given buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
const crc32 = (buf) => {
	let res = -1;
	for (let i = 0; i < buf.length; i++)
		res = table[(res ^ buf[i]) & 0xFF] ^ (res >>> 8);

	return res ^ -1;
};

module.exports = crc32;