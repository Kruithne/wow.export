/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const util = require('util');
const crypto = require('crypto');
const zlib = require('zlib');
const path = require('path');
const crc32 = require('./crc32');
const fsp = require('fs').promises;

const LITTLE_ENDIAN = {
	READ_INT: Buffer.prototype.readIntLE,
	READ_UINT: Buffer.prototype.readUIntLE,
	READ_FLOAT: Buffer.prototype.readFloatLE,
	READ_DOUBLE: Buffer.prototype.readDoubleLE,
	READ_BIG_INT: Buffer.prototype.readBigInt64LE,
	READ_BIG_UINT: Buffer.prototype.readBigUInt64LE,
	WRITE_INT: Buffer.prototype.writeIntLE,
	WRITE_UINT: Buffer.prototype.writeUIntLE,
	WRITE_FLOAT: Buffer.prototype.writeFloatLE,
	WRITE_BIG_INT: Buffer.prototype.writeBigInt64LE,
	WRITE_BIG_UINT: Buffer.prototype.writeBigUInt64LE
};

const BIG_ENDIAN = {
	READ_INT: Buffer.prototype.readIntBE,
	READ_UINT: Buffer.prototype.readUIntBE,
	READ_FLOAT: Buffer.prototype.readFloatBE,
	READ_DOUBLE: Buffer.prototype.readDoubleBE,
	READ_BIG_INT: Buffer.prototype.readBigInt64BE,
	READ_BIG_UINT: Buffer.prototype.readBigUInt64BE,
	WRITE_INT: Buffer.prototype.writeIntBE,
	WRITE_UINT: Buffer.prototype.writeUIntBE,
	WRITE_FLOAT: Buffer.prototype.writeFloatBE,
	WRITE_BIG_INT: Buffer.prototype.writeBigInt64BE,
	WRITE_BIG_UINT: Buffer.prototype.writeBigUInt64BE
};

/**
 * This class is a wrapper for the node Buffer class which provides a more streamlined
 * interface for reading/writing data. Only required features have been implemented.
 * @class BufferWrapper
 */
class BufferWrapper {
	/**
	 * Alloc a buffer with the given length and return it wrapped.
	 * @param {number} length Initial capacity of the internal buffer.
	 * @param {boolean} secure If true, buffer will be zeroed for security.
	 * @returns {BufferWrapper}
	 */
	static alloc(length, secure = false) {
		return new BufferWrapper(secure ? Buffer.alloc(length) : Buffer.allocUnsafe(length));
	}

	/**
	 * Create a buffer from a source using Buffer.from().
	 * @param {Array} source 
	 */
	static from(source) {
		return new BufferWrapper(Buffer.from(source));
	}

	/**
	 * Create a buffer from a source using Buffer.from().
	 * @param {Array} source 
	 */
	static fromBase64(source) {
		return new BufferWrapper(Buffer.from(source, 'base64'));
	}

	/**
	 * Concatenate an array of buffers into a single buffer.
	 * @param {BufferWrapper[]} buffers 
	 * @returns {BufferWrapper}
	 */
	static concat(buffers) {
		return new BufferWrapper(Buffer.concat(buffers.map(buf => buf.raw)));
	}

	/**
	 * Create a BufferWrapper from a canvas element.
	 * @param {HTMLCanvasElement|OffscreenCanvas} canvas 
	 * @param {string} mimeType 
	 */
	static async fromCanvas(canvas, mimeType) {
		let blob;
		if (canvas instanceof OffscreenCanvas)
			blob = await canvas.convertToBlob({ type: mimeType });
		else
			blob = await new Promise(res => canvas.toBlob(res, mimeType));

		return new BufferWrapper(Buffer.from(await blob.arrayBuffer()));
	}

	/**
	 * Load a file from disk at the given path into a wrapped buffer.
	 * @param {string} file Path to the file.
	 */
	static async readFile(file) {
		return new BufferWrapper(await fsp.readFile(file));
	}

	/**
	 * Construct a new BufferWrapper.
	 * @param {Buffer} buf 
	 */
	constructor(buf) {
		this._ofs = 0;
		this._buf = buf;
	}

	/**
	 * Get the full capacity of the buffer.
	 * @returns {number}
	 */
	get byteLength() {
		return this._buf.byteLength;
	}

	/**
	 * Get the amount of remaining bytes until the end of the buffer.
	 * @returns {number}
	 */
	get remainingBytes() {
		return this.byteLength - this._ofs;
	}

	/**
	 * Get the current offset within the buffer.
	 * @returns {number}
	 */
	get offset() {
		return this._ofs;
	}

	/**
	 * Get the raw buffer wrapped by this instance.
	 * @returns {Buffer}
	 */
	get raw() {
		return this._buf;
	}

	/**
	 * Get the internal ArrayBuffer used by this instance.
	 * @returns {ArrayBuffer}
	 */
	get internalArrayBuffer() {
		return this._buf.buffer;
	}

	/**
	 * Set the absolute position of this buffer.
	 * Negative values will set the position from the end of the buffer.
	 * @param {number} ofs 
	 */
	seek(ofs) {
		const pos = ofs < 0 ? this.byteLength + ofs : ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('seek() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	/**
	 * Shift the position of the buffer relative to its current position.
	 * Positive numbers seek forward, negative seek backwards.
	 * @param {number} ofs 
	 */
	move(ofs) {
		const pos = this.offset + ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('move() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	/**
	 * Read one or more signed integers of variable byte length in little endian.
	 * @param {number} byteLength 
	 * @param {number} [count=1]
	 * @returns {number|number[]}
	 */
	readIntLE(byteLength, count = 1) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, byteLength);
	}

	/**
	 * Read one or more unsigned integers of variable byte length in little endian.
	 * @param {number} byteLength 
	 * @param {number} [count=1]
	 * @returns {number|number[]}
	 */
	readUIntLE(byteLength, count = 1) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, byteLength);
	}

	/**
	 * Read one or more signed integers of variable byte length in big endian.
	 * @param {number} byteLength 
	 * @param {number} [count=1]
	 * @returns {number}
	 */
	readIntBE(byteLength, count = 1) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, byteLength);
	}
	
	/**
	 * Read one or more unsigned integers of variable byte length in big endian.
	 * @param {number} byteLength 
	 * @param {number} [count=1]
	 * @returns {number}
	 */
	readUIntBE(byteLength, count = 1) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, byteLength);
	}

	/**
	 * Read one or more signed 8-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt8(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 1);
	}

	/**
	 * Read one or more unsigned 8-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt8(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 1);
	}

	/**
	 * Read one or more signed 16-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt16LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 2);
	}

	/**
	 * Read one or more unsigned 16-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt16LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 2);
	}

	/**
	 * Read one or more signed 16-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt16BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 2);
	}

	/**
	 * Read one or more unsigned 16-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt16BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 2);
	}

	/**
	 * Read one or more signed 24-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt24LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 3);
	}

	/**
	 * Read one or more unsigned 24-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt24LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 3);
	}

	/**
	 * Read one or more signed 24-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt24BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 3);
	}

	/**
	 * Read one or more unsigned 24-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt24BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 3);
	}

	/**
	 * Read one or more signed 32-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt32LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 4);
	}

	/**
	 * Read one or more unsigned 32-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt32LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 4);
	}

	/**
	 * Read one or more signed 32-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt32BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 4);
	}

	/**
	 * Read one or more unsigned 32-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt32BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 4);
	}

	/**
	 * Read one or more signed 40-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt40LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 5);
	}

	/**
	 * Read one or more unsigned 40-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt40LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 5);
	}

	/**
	 * Read one or more signed 40-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt40BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 5);
	}
	
	/**
	 * Read one or more unsigned 40-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt40BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 5);
	}

	/**
	 * Read one or more signed 48-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt48LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 6);
	}

	/**
	 * Read one or more unsigned 48-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt48LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 6);
	}

	/**
	 * Read one of more signed 48-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt48BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 6);
	}

	/**
	 * Read one or more unsigned 48-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt48BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 6);
	}

	/**
	 * Read one or more signed 64-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt64LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_BIG_INT, 8);
	}

	/**
	 * Read one or more unsigned 64-bit integers in little endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt64LE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_BIG_UINT, 8);
	}

	/**
	 * Read one or more signed 64-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readInt64BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_BIG_INT, 8);
	}

	/**
	 * Read one or more unsigned 64-bit integers in big endian.
	 * @param {number} count How many to read.
	 * @returns {number|number[]}
	 */
	readUInt64BE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_BIG_UINT, 8);
	}

	/**
	 * Read one or more floats in little endian.
	 * @param {number} count How many to read.
	 * @returns {float|float[]}
	 */
	readFloatLE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_FLOAT, 4);
	}

	/**
	 * Read one or more floats in big endian.
	 * @param {number} count How many to read.
	 * @returns {float|float[]}
	 */
	readFloatBE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_FLOAT, 4);
	}
	
	/**
	 * Read one or more doubles in little endian.
	 * @param {number} count How many to read.
	 * @returns {double|double[]}
	 */
	readDoubleLE(count) {
		return this._readInt(count, LITTLE_ENDIAN.READ_DOUBLE, 8);
	}

	/**
	 * Read one or more doubles in big endian.
	 * @param {number} count How many to read.
	 * @returns {double|double[]}
	 */
	readDoubleBE(count) {
		return this._readInt(count, BIG_ENDIAN.READ_DOUBLE, 8);
	}

	/**
	 * Read a portion of this buffer as a hex string.
	 * @param {number} length 
	 */
	readHexString(length) {
		this._checkBounds(length);
		const hex = this._buf.hexSlice(this._ofs, this._ofs + length);
		this._ofs += length;
		return hex;
	}

	/**
	 * Read a buffer from this buffer.
	 * @param {?number} length How many bytes to read into the buffer.
	 * @param {boolean} wrap If true, returns BufferWrapper, else raw buffer.
	 * @param {boolean} inflate If true, data will be decompressed using inflate.
	 */
	readBuffer(length = this.remainingBytes, wrap = true, inflate = false) {
		// Ensure we have enough data left to fulfill this.
		this._checkBounds(length);

		let buf = Buffer.allocUnsafe(length);
		this._buf.copy(buf, 0, this._ofs, this._ofs + length);
		this._ofs += length;

		if (inflate)
			buf = zlib.inflateSync(buf);

		return wrap ? new BufferWrapper(buf) : buf;
	}

	/**
	 * Read a string from the buffer.
	 * @param {?number} length 
	 * @param {string} [encoding=utf8]
	 * @returns {string}
	 */
	readString(length = this.remainingBytes, encoding = 'utf8') {
		// If length is zero, just return an empty string.
		if (length === 0)
			return '';

		this._checkBounds(length);
		const str = this._buf.toString(encoding, this._ofs, this._ofs + length);
		this._ofs += length;

		return str;
	}

	/**
	 * Read a null-terminated string from the buffer.
	 * @param {string} [encoding=utf8]
	 * @returns 
	 */
	readNullTerminatedString(encoding = 'utf8') {
		const startPos = this.offset;
		let length = 0;

		while (this.remainingBytes > 0) {
			if (this.readUInt8() === 0x0)
				break;

			length++;
		}

		this.seek(startPos);

		const str = this.readString(length, encoding);
		this.move(1); // Skip the null-terminator.
		return str;
	}

	/**
	 * Returns true if the buffer starts with any of the given string(s).
	 * @param {string|array} input 
	 * @param {string} [encoding=utf8]
	 * @returns {boolean}
	 */
	startsWith(input, encoding = 'utf8') {
		this.seek(0);
		if (Array.isArray(input)) {
			for (const entry of input) {
				if (this.readString(entry.length, encoding) === entry)
					return true;
			}

			return false;
		} else {
			return this.readString(input.length, encoding) === input;
		}
	}

	/**
	 * Read a string from the buffer and parse it as JSON.
	 * @param {?number} length
	 * @param {encoding} [encoding=utf8]
	 * @returns {object}
	 */
	readJSON(length = this.remainingBytes, encoding = 'utf8') {
		return JSON.parse(this.readString(length, encoding));
	}

	/**
	 * Read the entire buffer split by lines (\r\n, \n, \r).
	 * Preserves current offset of the wrapper.
	 * @param {string} encoding 
	 */
	readLines(encoding = 'utf8') {
		const ofs = this._ofs;
		this.seek(0);

		const str = this.readString(this.remainingBytes, encoding);
		this.seek(ofs);

		return str.split(/\r\n|\n|\r/);
	}

	/**
	 * Fill a buffer with the given value.
	 * @param {number} value 
	 * @param {number} length 
	 */
	fill(value, length = this.remainingBytes) {
		this._checkBounds(length);
		this._buf.fill(value, this._ofs, this._ofs + length);
		this._ofs += length;
	}

	/**
	 * Write a signed 8-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt8(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 1);
	}

	/**
	 * Write a unsigned 8-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt8(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 1);
	}

	/**
	 * Write a signed 16-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt16LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 2);
	}

	/**
	 * Write a unsigned 16-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt16LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 2);
	}

	/**
	 * Write a signed 16-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt16BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 2);
	}

	/**
	 * Write a unsigned 16-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt16BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 2);
	}

	/**
	 * Write a signed 24-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt24LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 3);
	}

	/**
	 * Write a unsigned 24-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt24LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 3);
	}

	/**
	 * Write a signed 24-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt24BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 3);
	}

	/**
	 * Write a unsigned 24-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt24BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 3);
	}

	/**
	 * Write a signed 32-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt32LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 4);
	}

	/**
	 * Write a unsigned 32-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt32LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 4);
	}

	/**
	 * Write a signed 32-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt32BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 4);
	}

	/**
	 * Write a unsigned 32-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt32BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 4);
	}

	/**
	 * Write a signed 40-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt40LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 5);
	}

	/**
	 * Write a unsigned 40-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt40LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 5);
	}

	/**
	 * Write a signed 40-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt40BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 5);
	}
	
	/**
	 * Write a unsigned 40-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt40BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 5);
	}

	/**
	 * Write a signed 48-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt48LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 6);
	}

	/**
	 * Write a unsigned 48-bit integer in little endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt48LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 6);
	}

	/**
	 * Write a signed 48-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeInt48BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 6);
	}

	/**
	 * Write a unsigned 48-bit integer in big endian.
	 * @param {number} value
	 * @returns {number|number[]}
	 */
	writeUInt48BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 6);
	}

	/**
	 * Write a signed 64-bit integer in little endian.
	 * @param {bigint} value
	 * @returns {number|number[]}
	 */
	writeBigInt64LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_INT, 8);
	}

	/**
	 * Write a unsigned 64-bit integer in little endian.
	 * @param {bigint} value
	 * @returns {number|number[]}
	 */
	writeBigUInt64LE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_UINT, 8);
	}

	/**
	 * Write a signed 64-bit integer in big endian.
	 * @param {bigint} value
	 * @returns {number|number[]}
	 */
	writeBigInt64BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_BIG_INT, 8);
	}

	/**
	 * Write a unsigned 64-bit integer in big endian.
	 * @param {bigint} value
	 * @returns {number|number[]}
	 */
	writeBigUInt64BE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_BIG_UINT, 8);
	}

	/**
	 * Write a float in little endian.
	 * @param {number} value
	 * @returns {float|float[]}
	 */
	writeFloatLE(value) {
		return this._writeInt(value, LITTLE_ENDIAN.WRITE_FLOAT, 4);
	}

	/**
	 * Write a float in big endian.
	 * @param {number} value
	 * @returns {float|float[]}
	 */
	writeFloatBE(value) {
		return this._writeInt(value, BIG_ENDIAN.WRITE_FLOAT, 4);
	}

	/**
	 * Write the contents of a buffer to this buffer.
	 * @param {Buffer|BufferWrapper} buf 
	 * @param {number} copyLength
	 */
	writeBuffer(buf, copyLength = 0) {
		let startIndex = 0;
		let rawBuf = buf;

		// Unwrap the internal buffer if this is a wrapper.
		if (buf instanceof BufferWrapper) {
			startIndex = buf.offset;
			
			if (copyLength === 0)
				copyLength = buf.remainingBytes;
			else
				buf._checkBounds(copyLength);

			rawBuf = buf.raw;
		} else {
			if (copyLength === 0)
				copyLength = buf.byteLength;
			else if (buf.length <= copyLength)
				new Error(util.format('Buffer operation out-of-bounds: %d > %d', copyLength, buf.byteLength));
		}

		// Ensure consuming this buffer won't overflow us.
		this._checkBounds(copyLength);

		rawBuf.copy(this._buf, this._ofs, startIndex, startIndex + copyLength);
		this._ofs += copyLength;

		if (buf instanceof BufferWrapper)
			buf._ofs += copyLength;
	}

	/**
	 * Write the contents of this buffer to a file.
	 * Directory path will be created if needed.
	 * @param {string} file 
	 */
	async writeToFile(file) {
		await fsp.mkdir(path.dirname(file), { recursive: true });
		await fsp.writeFile(file, this._buf);
	}

	/**
	 * Get the index of the given char from start.
	 * Defaults to the current reader offset.
	 * @param {string} char 
	 * @param {number} start 
	 * @returns {number}
	 */
	indexOfChar(char, start = this.offset) {
		if (char.length > 1)
			throw new Error('BufferWrapper.indexOfChar() given string, expected single character.');

		return this.indexOf(char.charCodeAt(0), start);
	}

	/**
	 * Get the index of the given byte from start.
	 * Defaults to the current reader offset.
	 * @param {number} byte
	 * @param {number} start 
	 * @returns {number}
	 */
	indexOf(byte, start = this.offset) {
		const resetPos = this.offset;
		this.seek(start);
		
		while (this.remainingBytes > 0) {
			const mark = this.offset;
			if (this.readUInt8() === byte) {
				this.seek(resetPos);
				return mark;
			}
		}

		this.seek(resetPos);
		return -1;
	}

	/**
	 * Decode this buffer using the given audio context.
	 * @param {AudioContext} context 
	 */
	async decodeAudio(context) {
		return await context.decodeAudioData(this._buf.buffer);
	}

	/**
	 * Assign a data URL for this buffer.
	 * @returns {string}
	 */
	getDataURL() {
		if (!this.dataURL) {
			const blob = new Blob([this.internalArrayBuffer]);
			this.dataURL = URL.createObjectURL(blob);
		}
		return this.dataURL;
	}

	/**
	 * Revoke the data URL assigned to this buffer.
	 */
	revokeDataURL() {
		if (this.dataURL) {
			URL.revokeObjectURL(this.dataURL);
			this.dataURL = undefined;
		}
	}

	/**
	 * Returns the entire buffer encoded as base64.
	 * @returns {string}
	 */
	toBase64() {
		return this._buf.toString('base64');
	}

	/**
	 * Replace the internal buffer with a different capacity.
	 * If the specified capacity is lower than the current, there may be data loss.
	 * @param {number} capacity New capacity of the internal buffer.
	 * @param {boolean} secure If true, expanded capacity will be zeroed for security.
	 */
	setCapacity(capacity, secure = false) {
		// Don't waste time replacing the buffer for nothing.
		if (capacity === this.byteLength)
			return;

		const buf = secure ? Buffer.alloc(capacity) : Buffer.allocUnsafe(capacity);
		this._buf.copy(buf, 0, 0, Math.min(capacity, this.byteLength));
		this._buf = buf;
	}

	/**
	 * Calculate a hash of this buffer
	 * @param {string} hash Hashing method, defaults to 'md5'.
	 * @param {string} encoding Output encoding, defaults to 'hex'.
	 */
	calculateHash(hash = 'md5', encoding = 'hex') {
		return crypto.createHash(hash).update(this._buf).digest(encoding);
	}

	/**
	 * Check if this buffer is entirely zeroed.
	 */
	isZeroed() {
		for (let i = 0, n = this.byteLength; i < n; i++) {
			if (this._buf[i] !== 0x0)
				return false;
		}

		return true;
	}

	/**
	 * Get the CRC32 checksum for this buffer.
	 * @returns {number}
	 */
	getCRC32() {
		return crc32(this.raw);
	}

	/**
	 * Returns a new deflated buffer using the contents of this buffer.
	 * @returns {BufferWrapper}
	 */
	deflate() {
		return new BufferWrapper(zlib.deflateSync(this._buf));
	}

	/**
	 * Check a given length does not exceed current capacity.
	 * @param {number} length 
	 */
	_checkBounds(length) {
		if (this.remainingBytes < length)
			throw new Error(util.format('Buffer operation out-of-bounds: %d > %d', length, this.remainingBytes));
	}

	/**
	 * Read one or more integers from the buffer.
	 * @param {number} count How many integers to read.
	 * @param {function} func Buffer prototype function.
	 * @param {number} byteLength Byte-length of each integer.
	 * @returns {number|number[]}
	 */
	_readInt(count, func, byteLength) {
		if (count !== undefined) {
			this._checkBounds(byteLength * count);

			const values = new Array(count);
			for (let i = 0; i < count; i++) {
				values[i] = func.call(this._buf, this._ofs, byteLength);
				this._ofs += byteLength;
			}

			return values;
		} else {
			this._checkBounds(byteLength);

			const value = func.call(this._buf, this._ofs, byteLength);
			this._ofs += byteLength;
			return value;
		}
	}

	/**
	 * Write an integer to the buffer.
	 * @param {number} value
	 * @param {function} func Buffer prototype function.
	 * @param {number} byteLength Byte-length of the number to write.
	 */
	_writeInt(value, func, byteLength) {
		this._checkBounds(byteLength);

		func.call(this._buf, value, this._ofs, byteLength);
		this._ofs += byteLength;
	}
}

module.exports = BufferWrapper;