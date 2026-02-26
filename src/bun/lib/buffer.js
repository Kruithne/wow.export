import util from 'node:util';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crc32 from './crc32.js';

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

class BufferWrapper {
	static alloc(length, secure = false) {
		return new BufferWrapper(secure ? Buffer.alloc(length) : Buffer.allocUnsafe(length));
	}

	static from(source) {
		return new BufferWrapper(Buffer.from(source));
	}

	static fromBase64(source) {
		return new BufferWrapper(Buffer.from(source, 'base64'));
	}

	static concat(buffers) {
		return new BufferWrapper(Buffer.concat(buffers.map(buf => buf.raw)));
	}

	static async readFile(file) {
		return new BufferWrapper(await fsp.readFile(file));
	}

	static fromMmap(mmapObj) {
		const wrapper = new BufferWrapper(Buffer.from(mmapObj.data));
		wrapper._mmap = mmapObj;
		return wrapper;
	}

	constructor(buf) {
		this._ofs = 0;
		this._buf = buf;
	}

	get byteLength() {
		return this._buf.byteLength;
	}

	get remainingBytes() {
		return this.byteLength - this._ofs;
	}

	get offset() {
		return this._ofs;
	}

	get raw() {
		return this._buf;
	}

	get internalArrayBuffer() {
		return this._buf.buffer;
	}

	seek(ofs) {
		const pos = ofs < 0 ? this.byteLength + ofs : ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('seek() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	move(ofs) {
		const pos = this.offset + ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('move() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	readIntLE(byteLength, count = 1) {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, byteLength);
	}

	readUIntLE(byteLength, count = 1) {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, byteLength);
	}

	readIntBE(byteLength, count = 1) {
		return this._readInt(count, BIG_ENDIAN.READ_INT, byteLength);
	}

	readUIntBE(byteLength, count = 1) {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, byteLength);
	}

	readInt8(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 1); }
	readUInt8(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 1); }
	readInt16LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 2); }
	readUInt16LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 2); }
	readInt16BE(count) { return this._readInt(count, BIG_ENDIAN.READ_INT, 2); }
	readUInt16BE(count) { return this._readInt(count, BIG_ENDIAN.READ_UINT, 2); }
	readInt24LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 3); }
	readUInt24LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 3); }
	readInt24BE(count) { return this._readInt(count, BIG_ENDIAN.READ_INT, 3); }
	readUInt24BE(count) { return this._readInt(count, BIG_ENDIAN.READ_UINT, 3); }
	readInt32LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 4); }
	readUInt32LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 4); }
	readInt32BE(count) { return this._readInt(count, BIG_ENDIAN.READ_INT, 4); }
	readUInt32BE(count) { return this._readInt(count, BIG_ENDIAN.READ_UINT, 4); }
	readInt40LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 5); }
	readUInt40LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 5); }
	readInt40BE(count) { return this._readInt(count, BIG_ENDIAN.READ_INT, 5); }
	readUInt40BE(count) { return this._readInt(count, BIG_ENDIAN.READ_UINT, 5); }
	readInt48LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_INT, 6); }
	readUInt48LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 6); }
	readInt48BE(count) { return this._readInt(count, BIG_ENDIAN.READ_INT, 6); }
	readUInt48BE(count) { return this._readInt(count, BIG_ENDIAN.READ_UINT, 6); }
	readInt64LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_BIG_INT, 8); }
	readUInt64LE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_BIG_UINT, 8); }
	readInt64BE(count) { return this._readInt(count, BIG_ENDIAN.READ_BIG_INT, 8); }
	readUInt64BE(count) { return this._readInt(count, BIG_ENDIAN.READ_BIG_UINT, 8); }
	readFloatLE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_FLOAT, 4); }
	readFloatBE(count) { return this._readInt(count, BIG_ENDIAN.READ_FLOAT, 4); }
	readDoubleLE(count) { return this._readInt(count, LITTLE_ENDIAN.READ_DOUBLE, 8); }
	readDoubleBE(count) { return this._readInt(count, BIG_ENDIAN.READ_DOUBLE, 8); }

	readHexString(length) {
		this._checkBounds(length);
		const hex = this._buf.subarray(this._ofs, this._ofs + length).toString('hex');
		this._ofs += length;
		return hex;
	}

	readBuffer(length = this.remainingBytes, wrap = true, inflate = false) {
		this._checkBounds(length);

		let buf = Buffer.allocUnsafe(length);
		this._buf.copy(buf, 0, this._ofs, this._ofs + length);
		this._ofs += length;

		if (inflate)
			buf = zlib.inflateSync(buf);

		return wrap ? new BufferWrapper(buf) : buf;
	}

	readString(length = this.remainingBytes, encoding = 'utf8') {
		if (length === 0)
			return '';

		this._checkBounds(length);
		const str = this._buf.toString(encoding, this._ofs, this._ofs + length);
		this._ofs += length;
		return str;
	}

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
		this.move(1);
		return str;
	}

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

	readJSON(length = this.remainingBytes, encoding = 'utf8') {
		return JSON.parse(this.readString(length, encoding));
	}

	readLines(encoding = 'utf8') {
		const ofs = this._ofs;
		this.seek(0);
		const str = this.readString(this.remainingBytes, encoding);
		this.seek(ofs);
		return str.split(/\r?\n/);
	}

	fill(value, length = this.remainingBytes) {
		this._checkBounds(length);
		this._buf.fill(value, this._ofs, this._ofs + length);
		this._ofs += length;
	}

	writeInt8(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 1); }
	writeUInt8(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 1); }
	writeInt16LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 2); }
	writeUInt16LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 2); }
	writeInt16BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 2); }
	writeUInt16BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 2); }
	writeInt24LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 3); }
	writeUInt24LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 3); }
	writeInt24BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 3); }
	writeUInt24BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 3); }
	writeInt32LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 4); }
	writeUInt32LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 4); }
	writeInt32BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 4); }
	writeUInt32BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 4); }
	writeInt40LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 5); }
	writeUInt40LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 5); }
	writeInt40BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 5); }
	writeUInt40BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 5); }
	writeInt48LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 6); }
	writeUInt48LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 6); }
	writeInt48BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_INT, 6); }
	writeUInt48BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 6); }
	writeBigInt64LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_INT, 8); }
	writeBigUInt64LE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_UINT, 8); }
	writeBigInt64BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_BIG_INT, 8); }
	writeBigUInt64BE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_BIG_UINT, 8); }
	writeFloatLE(value) { return this._writeInt(value, LITTLE_ENDIAN.WRITE_FLOAT, 4); }
	writeFloatBE(value) { return this._writeInt(value, BIG_ENDIAN.WRITE_FLOAT, 4); }

	writeBuffer(buf, copyLength = 0) {
		let startIndex = 0;
		let rawBuf = buf;

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

		this._checkBounds(copyLength);

		rawBuf.copy(this._buf, this._ofs, startIndex, startIndex + copyLength);
		this._ofs += copyLength;

		if (buf instanceof BufferWrapper)
			buf._ofs += copyLength;
	}

	async writeToFile(file) {
		await fsp.mkdir(path.dirname(file), { recursive: true });
		await fsp.writeFile(file, this._buf);
	}

	indexOfChar(char, start = this.offset) {
		if (char.length > 1)
			throw new Error('BufferWrapper.indexOfChar() given string, expected single character.');

		return this.indexOf(char.charCodeAt(0), start);
	}

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

	toBase64() {
		return this._buf.toString('base64');
	}

	setCapacity(capacity, secure = false) {
		if (capacity === this.byteLength)
			return;

		const buf = secure ? Buffer.alloc(capacity) : Buffer.allocUnsafe(capacity);
		this._buf.copy(buf, 0, 0, Math.min(capacity, this.byteLength));
		this._buf = buf;
	}

	calculateHash(hash = 'md5', encoding = 'hex') {
		return crypto.createHash(hash).update(this._buf).digest(encoding);
	}

	isZeroed() {
		for (let i = 0, n = this.byteLength; i < n; i++) {
			if (this._buf[i] !== 0x0)
				return false;
		}
		return true;
	}

	getCRC32() {
		return crc32(this.raw);
	}

	unmapSource() {
		if (this._mmap) {
			this._mmap.unmap();
			this._mmap = null;
		}
	}

	deflate() {
		return new BufferWrapper(zlib.deflateSync(this._buf));
	}

	_checkBounds(length) {
		if (this.remainingBytes < length)
			throw new Error(util.format('Buffer operation out-of-bounds: %d > %d', length, this.remainingBytes));
	}

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

	_writeInt(value, func, byteLength) {
		this._checkBounds(byteLength);

		func.call(this._buf, value, this._ofs, byteLength);
		this._ofs += byteLength;
	}
}

export default BufferWrapper;
