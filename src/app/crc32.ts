/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
const table = Array(256);

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

/**
 * Calculate the CRC32 value of a given buffer.#
 * @param buf - The buffer to calculate the CRC32 value of.
 * @returns The CRC32 value of the buffer.
 */
export default function crc32(buf: Buffer): number {
	let res = -1;
	for (let i = 0; i < buf.length; i++)
		res = table[(res ^ buf[i]) & 0xFF] ^ (res >>> 8);

	return res ^ -1;
}