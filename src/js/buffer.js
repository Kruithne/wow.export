import pako from 'pako';
import crc32 from './crc32.js';
import webp from 'webp-wasm';

const TEXT_DECODER = new TextDecoder('utf-8');
const TEXT_ENCODER = new TextEncoder();

class BufferWrapper {
	static alloc(length, secure = false) {
		const buf = new Uint8Array(length);
		return new BufferWrapper(buf);
	}

	static from(source) {
		if (source instanceof ArrayBuffer)
			return new BufferWrapper(new Uint8Array(source));

		if (source instanceof Uint8Array)
			return new BufferWrapper(new Uint8Array(source));

		if (Array.isArray(source))
			return new BufferWrapper(new Uint8Array(source));

		return new BufferWrapper(new Uint8Array(source));
	}

	static fromBase64(source) {
		const binary = atob(source);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++)
			bytes[i] = binary.charCodeAt(i);

		return new BufferWrapper(bytes);
	}

	static concat(buffers) {
		let total = 0;
		for (const buf of buffers)
			total += buf.byteLength;

		const result = new Uint8Array(total);
		let offset = 0;
		for (const buf of buffers) {
			result.set(buf._buf, offset);
			offset += buf.byteLength;
		}

		return new BufferWrapper(result);
	}

	static async fromCanvas(canvas, mime_type, quality = 90) {
		if (mime_type === 'image/webp' && quality === 100) {
			const ctx = canvas.getContext('2d');
			const image_data = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const webp_buffer = await webp.encode(image_data, { lossless: true });
			return new BufferWrapper(new Uint8Array(webp_buffer));
		}

		const browser_quality = quality / 100;

		let blob;
		if (canvas instanceof OffscreenCanvas)
			blob = await canvas.convertToBlob({ type: mime_type, quality: browser_quality });
		else
			blob = await new Promise(res => canvas.toBlob(res, mime_type, browser_quality));

		return new BufferWrapper(new Uint8Array(await blob.arrayBuffer()));
	}

	constructor(buf) {
		this._ofs = 0;

		if (buf instanceof Uint8Array) {
			this._buf = buf;
		} else if (buf instanceof ArrayBuffer) {
			this._buf = new Uint8Array(buf);
		} else {
			this._buf = new Uint8Array(buf);
		}

		this._dv = new DataView(this._buf.buffer, this._buf.byteOffset, this._buf.byteLength);
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
			throw new Error('seek() offset out of bounds ' + ofs + ' -> ' + pos + ' ! ' + this.byteLength);

		this._ofs = pos;
	}

	move(ofs) {
		const pos = this.offset + ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error('move() offset out of bounds ' + ofs + ' -> ' + pos + ' ! ' + this.byteLength);

		this._ofs = pos;
	}

	// -- read integers --

	readInt8(count) {
		if (count !== undefined) {
			this._checkBounds(count);
			const values = new Array(count);
			for (let i = 0; i < count; i++) {
				values[i] = this._dv.getInt8(this._ofs);
				this._ofs += 1;
			}
			return values;
		}

		this._checkBounds(1);
		const v = this._dv.getInt8(this._ofs);
		this._ofs += 1;
		return v;
	}

	readUInt8(count) {
		if (count !== undefined) {
			this._checkBounds(count);
			const values = new Array(count);
			for (let i = 0; i < count; i++) {
				values[i] = this._buf[this._ofs];
				this._ofs += 1;
			}
			return values;
		}

		this._checkBounds(1);
		const v = this._buf[this._ofs];
		this._ofs += 1;
		return v;
	}

	readInt16LE(count) { return this._readTyped(count, 2, true, 'getInt16'); }
	readUInt16LE(count) { return this._readTyped(count, 2, true, 'getUint16'); }
	readInt16BE(count) { return this._readTyped(count, 2, false, 'getInt16'); }
	readUInt16BE(count) { return this._readTyped(count, 2, false, 'getUint16'); }

	readInt24LE(count) { return this._readVarInt(count, 3, true, true); }
	readUInt24LE(count) { return this._readVarInt(count, 3, false, true); }
	readInt24BE(count) { return this._readVarInt(count, 3, true, false); }
	readUInt24BE(count) { return this._readVarInt(count, 3, false, false); }

	readInt32LE(count) { return this._readTyped(count, 4, true, 'getInt32'); }
	readUInt32LE(count) { return this._readTyped(count, 4, true, 'getUint32'); }
	readInt32BE(count) { return this._readTyped(count, 4, false, 'getInt32'); }
	readUInt32BE(count) { return this._readTyped(count, 4, false, 'getUint32'); }

	readInt40LE(count) { return this._readVarInt(count, 5, true, true); }
	readUInt40LE(count) { return this._readVarInt(count, 5, false, true); }
	readInt40BE(count) { return this._readVarInt(count, 5, true, false); }
	readUInt40BE(count) { return this._readVarInt(count, 5, false, false); }

	readInt48LE(count) { return this._readVarInt(count, 6, true, true); }
	readUInt48LE(count) { return this._readVarInt(count, 6, false, true); }
	readInt48BE(count) { return this._readVarInt(count, 6, true, false); }
	readUInt48BE(count) { return this._readVarInt(count, 6, false, false); }

	readInt64LE(count) { return this._readTyped(count, 8, true, 'getBigInt64'); }
	readUInt64LE(count) { return this._readTyped(count, 8, true, 'getBigUint64'); }
	readInt64BE(count) { return this._readTyped(count, 8, false, 'getBigInt64'); }
	readUInt64BE(count) { return this._readTyped(count, 8, false, 'getBigUint64'); }

	readFloatLE(count) { return this._readTyped(count, 4, true, 'getFloat32'); }
	readFloatBE(count) { return this._readTyped(count, 4, false, 'getFloat32'); }
	readDoubleLE(count) { return this._readTyped(count, 8, true, 'getFloat64'); }
	readDoubleBE(count) { return this._readTyped(count, 8, false, 'getFloat64'); }

	// variable-length integer reads for generic API compat
	readIntLE(byte_length, count = 1) { return this._readVarInt(count, byte_length, true, true); }
	readUIntLE(byte_length, count = 1) { return this._readVarInt(count, byte_length, false, true); }
	readIntBE(byte_length, count = 1) { return this._readVarInt(count, byte_length, true, false); }
	readUIntBE(byte_length, count = 1) { return this._readVarInt(count, byte_length, false, false); }

	// -- read strings --

	readHexString(length) {
		this._checkBounds(length);
		let hex = '';
		for (let i = 0; i < length; i++)
			hex += this._buf[this._ofs + i].toString(16).padStart(2, '0');

		this._ofs += length;
		return hex;
	}

	readBuffer(length = this.remainingBytes, wrap = true, inflate = false) {
		this._checkBounds(length);

		let buf = this._buf.slice(this._ofs, this._ofs + length);
		this._ofs += length;

		if (inflate)
			buf = pako.inflate(buf);

		return wrap ? new BufferWrapper(buf) : buf;
	}

	readString(length = this.remainingBytes, encoding = 'utf8') {
		if (length === 0)
			return '';

		this._checkBounds(length);
		const slice = this._buf.subarray(this._ofs, this._ofs + length);
		this._ofs += length;

		return TEXT_DECODER.decode(slice);
	}

	readNullTerminatedString(encoding = 'utf8') {
		const start = this.offset;
		let length = 0;

		while (this.remainingBytes > 0) {
			if (this.readUInt8() === 0x0)
				break;

			length++;
		}

		this.seek(start);
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

				this.seek(0);
			}
			return false;
		}

		return this.readString(input.length, encoding) === input;
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

	// -- write integers --

	writeInt8(value) { this._checkBounds(1); this._dv.setInt8(this._ofs, value); this._ofs += 1; }
	writeUInt8(value) { this._checkBounds(1); this._buf[this._ofs] = value & 0xFF; this._ofs += 1; }

	writeInt16LE(value) { this._writeTyped(value, 2, true, 'setInt16'); }
	writeUInt16LE(value) { this._writeTyped(value, 2, true, 'setUint16'); }
	writeInt16BE(value) { this._writeTyped(value, 2, false, 'setInt16'); }
	writeUInt16BE(value) { this._writeTyped(value, 2, false, 'setUint16'); }

	writeInt24LE(value) { this._writeVarInt(value, 3, true); }
	writeUInt24LE(value) { this._writeVarInt(value, 3, true); }
	writeInt24BE(value) { this._writeVarInt(value, 3, false); }
	writeUInt24BE(value) { this._writeVarInt(value, 3, false); }

	writeInt32LE(value) { this._writeTyped(value, 4, true, 'setInt32'); }
	writeUInt32LE(value) { this._writeTyped(value, 4, true, 'setUint32'); }
	writeInt32BE(value) { this._writeTyped(value, 4, false, 'setInt32'); }
	writeUInt32BE(value) { this._writeTyped(value, 4, false, 'setUint32'); }

	writeInt40LE(value) { this._writeVarInt(value, 5, true); }
	writeUInt40LE(value) { this._writeVarInt(value, 5, true); }
	writeInt40BE(value) { this._writeVarInt(value, 5, false); }
	writeUInt40BE(value) { this._writeVarInt(value, 5, false); }

	writeInt48LE(value) { this._writeVarInt(value, 6, true); }
	writeUInt48LE(value) { this._writeVarInt(value, 6, true); }
	writeInt48BE(value) { this._writeVarInt(value, 6, false); }
	writeUInt48BE(value) { this._writeVarInt(value, 6, false); }

	writeBigInt64LE(value) { this._writeTyped(value, 8, true, 'setBigInt64'); }
	writeBigUInt64LE(value) { this._writeTyped(value, 8, true, 'setBigUint64'); }
	writeBigInt64BE(value) { this._writeTyped(value, 8, false, 'setBigInt64'); }
	writeBigUInt64BE(value) { this._writeTyped(value, 8, false, 'setBigUint64'); }

	writeFloatLE(value) { this._writeTyped(value, 4, true, 'setFloat32'); }
	writeFloatBE(value) { this._writeTyped(value, 4, false, 'setFloat32'); }

	// -- buffer operations --

	fill(value, length = this.remainingBytes) {
		this._checkBounds(length);
		this._buf.fill(value, this._ofs, this._ofs + length);
		this._ofs += length;
	}

	writeBuffer(buf, copy_length = 0) {
		let start_index = 0;
		let raw_buf;

		if (buf instanceof BufferWrapper) {
			start_index = buf.offset;
			if (copy_length === 0)
				copy_length = buf.remainingBytes;
			else
				buf._checkBounds(copy_length);

			raw_buf = buf.raw;
		} else {
			if (buf instanceof ArrayBuffer)
				buf = new Uint8Array(buf);

			if (copy_length === 0)
				copy_length = buf.byteLength;

			raw_buf = buf;
		}

		this._checkBounds(copy_length);
		this._buf.set(raw_buf.subarray(start_index, start_index + copy_length), this._ofs);
		this._ofs += copy_length;

		if (buf instanceof BufferWrapper)
			buf._ofs += copy_length;
	}

	async writeToFile(file) {
		const { fs } = await import('../views/main/rpc.js');
		await fs.write_file(file, this._buf.buffer);
	}

	// -- search operations --

	indexOfChar(char, start = this.offset) {
		if (char.length > 1)
			throw new Error('BufferWrapper.indexOfChar() given string, expected single character.');

		return this.indexOf(char.charCodeAt(0), start);
	}

	indexOf(byte, start = this.offset) {
		const reset_pos = this.offset;
		this.seek(start);

		while (this.remainingBytes > 0) {
			const mark = this.offset;
			if (this.readUInt8() === byte) {
				this.seek(reset_pos);
				return mark;
			}
		}

		this.seek(reset_pos);
		return -1;
	}

	// -- audio/media --

	async decodeAudio(context) {
		const copy = this._buf.buffer.slice(
			this._buf.byteOffset,
			this._buf.byteOffset + this._buf.byteLength
		);
		return await context.decodeAudioData(copy);
	}

	getDataURL() {
		if (!this.dataURL) {
			const blob = new Blob([this._buf]);
			this.dataURL = URL.createObjectURL(blob);
		}
		return this.dataURL;
	}

	revokeDataURL() {
		if (this.dataURL) {
			URL.revokeObjectURL(this.dataURL);
			this.dataURL = undefined;
		}
	}

	toBase64() {
		const chunk_size = 8192;
		let binary = '';
		for (let i = 0; i < this._buf.length; i += chunk_size)
			binary += String.fromCharCode.apply(null, this._buf.subarray(i, i + chunk_size));

		return btoa(binary);
	}

	// -- capacity / transform --

	setCapacity(capacity, secure = false) {
		if (capacity === this.byteLength)
			return;

		const buf = new Uint8Array(capacity);
		buf.set(this._buf.subarray(0, Math.min(capacity, this.byteLength)));
		this._buf = buf;
		this._dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	}

	calculateHash(hash = 'md5', encoding = 'hex') {
		// async web crypto, but keep sync signature for compat
		// callers that need hash should use calculateHashAsync
		throw new Error('calculateHash is not supported in browser; use calculateHashAsync');
	}

	async calculateHashAsync(algorithm = 'SHA-256') {
		const hash_buf = await crypto.subtle.digest(algorithm, this._buf);
		const arr = new Uint8Array(hash_buf);
		return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	isZeroed() {
		for (let i = 0, n = this.byteLength; i < n; i++) {
			if (this._buf[i] !== 0x0)
				return false;
		}
		return true;
	}

	getCRC32() {
		return crc32(this._buf);
	}

	unmapSource() {
		// no-op in browser
	}

	deflate() {
		return new BufferWrapper(pako.deflate(this._buf));
	}

	// -- internals --

	_checkBounds(length) {
		if (this.remainingBytes < length)
			throw new Error('Buffer operation out-of-bounds: ' + length + ' > ' + this.remainingBytes);
	}

	_readTyped(count, byte_length, little_endian, method) {
		if (count !== undefined) {
			this._checkBounds(byte_length * count);
			const values = new Array(count);
			for (let i = 0; i < count; i++) {
				values[i] = this._dv[method](this._ofs, little_endian);
				this._ofs += byte_length;
			}
			return values;
		}

		this._checkBounds(byte_length);
		const value = this._dv[method](this._ofs, little_endian);
		this._ofs += byte_length;
		return value;
	}

	_readVarInt(count, byte_length, signed, little_endian) {
		const read_one = () => {
			this._checkBounds(byte_length);
			let val = 0;

			if (little_endian) {
				for (let i = 0; i < byte_length; i++)
					val |= this._buf[this._ofs + i] << (i * 8);
			} else {
				for (let i = 0; i < byte_length; i++)
					val |= this._buf[this._ofs + i] << ((byte_length - 1 - i) * 8);
			}

			// handle sign extension
			if (signed && byte_length < 4) {
				const sign_bit = 1 << (byte_length * 8 - 1);
				if (val & sign_bit)
					val |= -1 << (byte_length * 8);
			}

			// for 5-6 byte reads, ensure unsigned conversion
			if (!signed)
				val = val >>> 0;

			this._ofs += byte_length;
			return val;
		};

		if (count !== undefined) {
			const values = new Array(count);
			for (let i = 0; i < count; i++)
				values[i] = read_one();

			return values;
		}

		return read_one();
	}

	_writeTyped(value, byte_length, little_endian, method) {
		this._checkBounds(byte_length);
		this._dv[method](this._ofs, value, little_endian);
		this._ofs += byte_length;
	}

	_writeVarInt(value, byte_length, little_endian) {
		this._checkBounds(byte_length);

		if (little_endian) {
			for (let i = 0; i < byte_length; i++)
				this._buf[this._ofs + i] = (value >> (i * 8)) & 0xFF;
		} else {
			for (let i = 0; i < byte_length; i++)
				this._buf[this._ofs + i] = (value >> ((byte_length - 1 - i) * 8)) & 0xFF;
		}

		this._ofs += byte_length;
	}
}

export default BufferWrapper;
