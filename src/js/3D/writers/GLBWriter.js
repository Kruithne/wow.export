/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */


import BufferWrapper from '../../buffer.js';

// glb magic number: 'glTF' in ascii
const GLB_MAGIC = 0x46546C67;
const GLB_VERSION = 2;

// chunk types
const CHUNK_TYPE_JSON = 0x4E4F534A;
const CHUNK_TYPE_BIN = 0x004E4942;

class GLBWriter {
	/**
	 * construct glb writer with json and binary data
	 * @param {string} json_string
	 * @param {BufferWrapper} bin_buffer
	 */
	constructor(json_string, bin_buffer) {
		this.json_string = json_string;
		this.bin_buffer = bin_buffer;
	}

	/**
	 * pack json and binary data into glb container
	 * @returns {BufferWrapper}
	 */
	pack() {
		const json_buffer = new TextEncoder().encode(this.json_string);

		// calculate padding for json chunk (must be 4-byte aligned, padded with spaces 0x20)
		const json_padding = (4 - (json_buffer.length % 4)) % 4;
		const json_chunk_length = json_buffer.length + json_padding;

		// calculate padding for bin chunk (must be 4-byte aligned, padded with zeros)
		const bin_padding = (4 - (this.bin_buffer.byteLength % 4)) % 4;
		const bin_chunk_length = this.bin_buffer.byteLength + bin_padding;

		// calculate total file length
		// 12 bytes header + 8 bytes json chunk header + json data + 8 bytes bin chunk header + bin data
		const total_length = 12 + 8 + json_chunk_length + 8 + bin_chunk_length;

		const glb = BufferWrapper.alloc(total_length, true);

		// write glb header
		glb.writeUInt32LE(GLB_MAGIC);
		glb.writeUInt32LE(GLB_VERSION);
		glb.writeUInt32LE(total_length);

		// write json chunk
		glb.writeUInt32LE(json_chunk_length);
		glb.writeUInt32LE(CHUNK_TYPE_JSON);
		glb.writeBuffer(json_buffer);

		// pad json chunk with spaces
		for (let i = 0; i < json_padding; i++)
			glb.writeUInt8(0x20);

		// write bin chunk
		glb.writeUInt32LE(bin_chunk_length);
		glb.writeUInt32LE(CHUNK_TYPE_BIN);
		glb.writeBuffer(this.bin_buffer.raw);

		// pad bin chunk with zeros
		for (let i = 0; i < bin_padding; i++)
			glb.writeUInt8(0x00);

		return glb;
	}
}

export default GLBWriter;