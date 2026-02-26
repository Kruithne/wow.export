/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

import BitStream from './bitstream.js';

// LZ77 with Huffman coding
// ref: https://groups.google.com/g/comp.compression/c/M5P064or93o/m/W1ca1-ad6kgJ?pli=1
// ref: http://justsolve.archiveteam.org/wiki/PKWARE_DCL_Implode

const CompressionType = {
	Binary: 0, // Binary compression mode
	Ascii: 1,  // ASCII/text compression mode (not implemented)
};

class PKLibDecompress {
	static LEN_BITS = new Uint8Array([
		3, 2, 3, 3, 4, 4, 4, 5,
		5, 5, 5, 6, 6, 6, 7, 7
	]);

	static LEN_CODE = new Uint8Array([
		5, 3, 1, 6, 10, 2, 12, 20,
		4, 24, 8, 48, 16, 32, 64, 0
	]);

	static EX_LEN_BITS = new Uint8Array([
		0, 0, 0, 0, 0, 0, 0, 0,
		1, 2, 3, 4, 5, 6, 7, 8
	]);

	static LEN_BASE = new Uint16Array([
		0, 1, 2, 3, 4, 5, 6, 7,
		8, 10, 14, 22, 38, 70, 134, 262
	]);

	static DIST_BITS = new Uint8Array([
		2, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8
	]);

	static DIST_CODE = new Uint8Array([
		3, 13, 5, 25, 9, 17, 1, 62, 30, 46, 14, 54, 22, 38, 6, 58,
		26, 42, 10, 50, 18, 34, 66, 2, 124, 60, 92, 28, 108, 44, 76, 12,
		116, 52, 84, 20, 100, 36, 68, 4, 120, 56, 88, 24, 104, 40, 72, 8,
		240, 112, 176, 48, 208, 80, 144, 16, 224, 96, 160, 32, 192, 64, 128, 0
	]);

	static positionTable1;
	static positionTable2;

	static generateDecodeTable(bits, codes) {
		const table = new Uint8Array(256);

		for (let i = bits.length - 1; i >= 0; i--) {
			const code = codes[i];
			const step = 1 << bits[i];

			for (let j = code; j < 256; j += step)
				table[j] = i;
		}

		return table;
	}

	constructor(data) {
		if (data.length < 2)
			throw new Error('input too short for PKWare header');

		this.compressionType = data[0];
		this.dictionarySizeBits = data[1];

		if (this.compressionType !== CompressionType.Binary && this.compressionType !== CompressionType.Ascii)
			throw new Error(`invalid compression type: ${this.compressionType}`);

		if (this.dictionarySizeBits < 4 || this.dictionarySizeBits > 6)
			throw new Error(`invalid dictionary size: ${this.dictionarySizeBits}`);

		this.stream = new BitStream(data.subarray(2));
	}

	explode(expectedSize) {
		const output = new Uint8Array(expectedSize);
		let out_pos = 0;

		while (true) {
			const literal_len = this.decodeLiteral();

			if (literal_len === -1)
				break; // eos

			if (literal_len < 256) {
				if (out_pos >= expectedSize) // copy literal bytes directly
					break;

				output[out_pos++] = literal_len;
			} else {
				const length = literal_len - 254; // convert to actual length
				const distance = this.decodeDistance(length);

				if (distance === 0)
					break; // eos

				const source_pos = out_pos - distance;
				if (source_pos < 0 || out_pos + length > expectedSize)
					break; // invalid back-reference

				for (let i = 0; i < length; i++)
					output[out_pos++] = output[source_pos + i];
			}
		}

		if (out_pos === expectedSize)
			return output;

		return output.subarray(0, out_pos);
	}

	decodeLiteral() {
		const flag = this.stream.readBits(1);

		if (flag === -1)
			return -1;

		if (flag === 0) {
			if (this.compressionType === CompressionType.Binary)
				return this.stream.readBits(8);

			throw new Error('ASCII/text compression mode is not implemented');
		} else {
			const peek = this.stream.peekByte();
			if (peek === -1)
				return -1;

			const index = PKLibDecompress.positionTable2[peek];
			const bits_read = this.stream.readBits(PKLibDecompress.LEN_BITS[index]);

			if (bits_read === -1)
				return -1;

			const extra_bits = PKLibDecompress.EX_LEN_BITS[index];
			let symbol_val = index;

			if (extra_bits !== 0) {
				const extra = this.stream.readBits(extra_bits);

				if (extra === -1 && PKLibDecompress.LEN_BASE[index] + extra !== 270)
					return -1;

				symbol_val = PKLibDecompress.LEN_BASE[index] + extra;
			}

			return symbol_val + 256;
		}
	}

	decodeDistance(length) {
		if (!this.stream.ensureBits(8))
			return 0;

		const peek = this.stream.peekByte();
		const index = PKLibDecompress.positionTable1[peek];

		if (this.stream.readBits(PKLibDecompress.DIST_BITS[index]) === -1)
			return 0;

		let distance;

		if (length === 2) {
			if (!this.stream.ensureBits(2)) // special case
				return 0;

			distance = (index << 2) | this.stream.readBits(2);
		} else {
			if (!this.stream.ensureBits(this.dictionarySizeBits))
				return 0;

			distance = (index << this.dictionarySizeBits) | this.stream.readBits(this.dictionarySizeBits);
		}

		return distance + 1; // not zero indexed
	}
}

// Initialize static lookup tables
PKLibDecompress.positionTable1 = PKLibDecompress.generateDecodeTable(
	PKLibDecompress.DIST_BITS,
	PKLibDecompress.DIST_CODE
);
PKLibDecompress.positionTable2 = PKLibDecompress.generateDecodeTable(
	PKLibDecompress.LEN_BITS,
	PKLibDecompress.LEN_CODE
);

function pkware_dcl_explode(compressedData, expectedLength) {
	const decompressor = new PKLibDecompress(compressedData);
	return decompressor.explode(expectedLength);
}

export { pkware_dcl_explode };
