/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import fs from 'node:fs/promises';
import crc32 from './crc32';

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

type BufferReadWriteFunc = (this: Buffer, offset: number, value: number) => void;

export default class BufferWrapper {
	/**
	 * Allocate a buffer with the given length and return it in a BufferWrapper.
	 * @param length - Initial capacity of the internal buffer.
	 * @param secure - If true, buffer will be zeroed for security.
	 * @returns The allocated buffer wrapped in a BufferWrapper.
	 */
	static alloc(length: number, secure: boolean = false): BufferWrapper {
		return new BufferWrapper(secure ? Buffer.alloc(length) : Buffer.allocUnsafe(length));
	}

	/**
	 * Create a wrapped buffer from a source using Buffer.from().
	 * @see https://nodejs.org/api/buffer.html#static-method-bufferfromarray
	 * @param source - Source to create the buffer from.
	 * @returns The created buffer wrapped in a BufferWrapper.
	 */
	static from(source: ArrayBuffer): BufferWrapper;
	static from(source: Uint8Array | readonly number[]): BufferWrapper;
	static from(source: any): BufferWrapper {
		return new BufferWrapper(Buffer.from(source));
	}

	/**
	 * Create a BufferWrapper from a canvas element.
	 * @param canvas - Canvas element to create the buffer from.
	 * @param mimeType - MIME type of the canvas data.
	 * @returns The created buffer wrapped in a BufferWrapper.
	 */
	static async fromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, mimeType: string): Promise<BufferWrapper> {
		let blob: Blob;
		if (canvas instanceof OffscreenCanvas)
			blob = await canvas.convertToBlob({ type: mimeType });
		else
			blob = await new Promise(res => canvas.toBlob(() => res, mimeType));

		return new BufferWrapper(Buffer.from(await blob.arrayBuffer()));
	}

	/**
	 * Load a file from disk at the given path into a wrapped buffer.
	 * @param {string} file Path to the file.
	 */
	static async readFile(file: string) {
		return new BufferWrapper(await fs.readFile(file));
	}

	_ofs: number = 0; // NIT: Rename and use private.
	_buf: Buffer; // NIT: Rename and use private.
	dataURL: string | undefined; // NIT: Use private.

	/**
	 * Create a new BufferWrapper instance.
	 * @param buf - Buffer to wrap.
	 */
	constructor(buf: Buffer) {
		this._buf = buf;
	}

	/**
	 * @returns Full capacity of the buffer.
	 */
	get byteLength(): number {
		return this._buf.byteLength;
	}

	/**
	 * @returns Amount of remaining bytes until the end of the buffer.
	 */
	get remainingBytes(): number {
		return this.byteLength - this._ofs;
	}

	/**
	 * @returns Current offset within the buffer.
	 */
	get offset(): number {
		return this._ofs;
	}

	/**
	 * @returns Raw buffer wrapped by this instance.
	 * // NIT: Rename to .buffer
	 */
	get raw(): Buffer {
		return this._buf;
	}

	/**
	 * @returns Internal ArrayBuffer used by this instance.
	 * // NIT: Rename to .arrayBuffer
	 */
	get internalArrayBuffer(): ArrayBuffer {
		return this._buf.buffer;
	}

	/**
	 * Set the absolute position of this buffer.
	 *
	 * @remarks
	 * Negative values will set the position from the end of the buffer.
	 *
	 * @param ofs - New position to set.
	 * @throws {@link Error} If the given position is out of bounds of the buffer.
	 */
	seek(ofs: number) {
		const pos = ofs < 0 ? this.byteLength + ofs : ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('seek() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	/**
	 * Shift the position of the buffer relative to its current position.
	 *
	 * @remarks
	 * Positive numbers seek forward, negative seek backwards.
	 *
	 * @param ofs - Offset to move the position by.
	 *
	 * @throws {@link Error} If the new position is out of bounds of the buffer.
	 */
	move(ofs: number) {
		const pos = this.offset + ofs;
		if (pos < 0 || pos > this.byteLength)
			throw new Error(util.format('move() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

		this._ofs = pos;
	}

	/**
	 * Read one or more signed integers of variable byte length in little endian.
	 * @param byteLength - How many bytes to read.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readIntLE(byteLength: number, count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, byteLength);
	}

	/**
	 * Read one or more unsigned integers of variable byte length in little endian.
	 * @param byteLength - How many bytes to read.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUIntLE(byteLength: number, count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, byteLength);
	}

	/**
	 * Read one or more signed integers of variable byte length in big endian.
	 * @param byteLength - How many bytes to read.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readIntBE(byteLength: number, count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, byteLength);
	}

	/**
	 * Read one or more unsigned integers of variable byte length in big endian.
	 * @param byteLength - How many bytes to read.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUIntBE(byteLength: number, count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, byteLength);
	}

	/**
	 * Read one or more signed 8-bit integers in little endian.
	 * @param count How many to read.
	 * @returns number | number[]
	 */
	readInt8(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 1);
	}

	/**
	 * Read one or more unsigned 8-bit integers in little endian.
	 * @param count How many to read.
	 * @returns number | number[]
	 */
	readUInt8(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 1);
	}

	/**
	 * Read one or more signed 16-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt16LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 2);
	}

	/**
	 * Read one or more signed 16-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt16LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 2);
	}

	/**
	 * Read one or more signed 16-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt16BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 2);
	}

	/**
	 * Read one or more unsigned 16-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt16BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 2);
	}

	/**
	 * Read one or more signed 24-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt24LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 3);
	}

	/**
	 * Read one or more unsigned 24-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt24LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 3);
	}

	/**
	 * Read one or more signed 24-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt24BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 3);
	}

	/**
	 * Read one or more unsigned 24-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt24BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 3);
	}

	/**
	 * Read one or more signed 32-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt32LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 4);
	}

	/**
	 * Read one or more unsigned 32-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt32LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 4);
	}

	/**
	 * Read one or more signed 32-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt32BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 4);
	}

	/**
	 * Read one or more unsigned 32-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt32BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 4);
	}

	/**
	 * Read one or more signed 40-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt40LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 5);
	}

	/**
	 * Read one or more unsigned 40-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt40LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 5);
	}

	/**
	 * Read one or more signed 40-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt40BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 5);
	}

	/**
	 * Read one or more unsigned 40-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt40BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 5);
	}

	/**
	 * Read one or more signed 48-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt48LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_INT, 6);
	}

	/**
	 * Read one or more unsigned 48-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt48LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_UINT, 6);
	}

	/**
	 * Read one of more signed 48-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt48BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_INT, 6);
	}

	/**
	 * Read one or more unsigned 48-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt48BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_UINT, 6);
	}

	/**
	 * Read one or more signed 64-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readInt64LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_BIG_INT, 8);
	}

	/**
	 * Read one or more unsigned 64-bit integers in little endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt64LE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_BIG_UINT, 8);
	}

	/**
	 * Read one or more signed 64-bit integers in big endian.
	 * @param count -  How many to read.
	 * @returns The read integer(s).
	 */
	readInt64BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_BIG_INT, 8);
	}

	/**
	 * Read one or more unsigned 64-bit integers in big endian.
	 * @param count - How many to read.
	 * @returns The read integer(s).
	 */
	readUInt64BE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_BIG_UINT, 8);
	}

	/**
	 * Read one or more floats in little endian.
	 * @param count - How many to read.
	 * @returns The read float(s).
	 */
	readFloatLE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_FLOAT, 4);
	}

	/**
	 * Read one or more floats in big endian.
	 * @param count - How many to read.
	 * @returns The read float(s).
	 */
	readFloatBE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_FLOAT, 4);
	}

	/**
	 * Read one or more doubles in little endian.
	 * @param count - How many to read.
	 * @returns The read double(s).
	 */
	readDoubleLE(count: number = 1): number | number[] {
		return this._readInt(count, LITTLE_ENDIAN.READ_DOUBLE, 8);
	}

	/**
	 * Read one or more doubles in big endian.
	 * @param count - How many to read.
	 * @returns The read double(s).
	 */
	readDoubleBE(count: number = 1): number | number[] {
		return this._readInt(count, BIG_ENDIAN.READ_DOUBLE, 8);
	}

	/**
	 * Read a portion of this buffer as a hex string.
	 * @param length - How many bytes to read.
	 * @returns The read hex string.
	 */
	readHexString(length: number) {
		this._checkBounds(length);
		const hex = this._buf.toString('hex', this._ofs, this._ofs + length); // NIT: Confirm this works.
		this._ofs += length;
		return hex;
	}

	/**
	 * Read a buffer from this buffer.
	 * @param length How many bytes to read into the buffer.
	 * @param wrap If true, returns BufferWrapper, else raw buffer.
	 * @param inflate If true, data will be decompressed using inflate.
	 */
	readBuffer(length: number = this.remainingBytes, wrap: boolean = true, inflate: boolean = false) {
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
	 * @param length - How many bytes to read.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns The read string.
	 */
	readString(length: number = this.remainingBytes, encoding: BufferEncoding = 'utf8'): string {
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
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns The read string.
	 */
	readNullTerminatedString(encoding?: BufferEncoding) {
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
	 * @param input - The string(s) to check for.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns True if the buffer starts with any of the given string(s).
	 */
	startsWith(input: string | string[], encoding?: BufferEncoding): boolean {
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
	 * @param length - How many bytes to read.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns The parsed JSON object.
	 */
	readJSON(length: number = this.remainingBytes, encoding?: BufferEncoding): object {
		return JSON.parse(this.readString(length, encoding));
	}

	/**
	 * Read the entire buffer split by lines (\r\n, \n, \r).
	 * Preserves current offset of the wrapper.
	 * @param encoding - The encoding to use (default: utf8)
	 */
	readLines(encoding?: BufferEncoding) {
		const ofs = this._ofs;
		this.seek(0);

		const str = this.readString(this.remainingBytes, encoding);
		this.seek(ofs);

		return str.split(/\r\n|\n|\r/);
	}

	/**
	 * Write a signed 8-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt8(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 1);
	}

	/**
	 * Write a unsigned 8-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt8(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 1);
	}

	/**
	 * Write a signed 16-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt16LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 2);
	}

	/**
	 * Write a unsigned 16-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt16LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 2);
	}

	/**
	 * Write a signed 16-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeInt16BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_INT, 2);
	}

	/**
	 * Write a unsigned 16-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeUInt16BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 2);
	}

	/**
	 * Write a signed 24-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt24LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 3);
	}

	/**
	 * Write a unsigned 24-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt24LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 3);
	}

	/**
	 * Write a signed 24-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeInt24BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_INT, 3);
	}

	/**
	 * Write a unsigned 24-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeUInt24BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 3);
	}

	/**
	 * Write a signed 32-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt32LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 4);
	}

	/**
	 * Write a unsigned 32-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt32LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 4);
	}

	/**
	 * Write a signed 32-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeInt32BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_INT, 4);
	}

	/**
	 * Write a unsigned 32-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeUInt32BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 4);
	}

	/**
	 * Write a signed 40-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt40LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 5);
	}

	/**
	 * Write a unsigned 40-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt40LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 5);
	}

	/**
	 * Write a signed 40-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeInt40BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_INT, 5);
	}

	/**
	 * Write a unsigned 40-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeUInt40BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 5);
	}

	/**
	 * Write a signed 48-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeInt48LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_INT, 6);
	}

	/**
	 * Write a unsigned 48-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeUInt48LE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_UINT, 6);
	}

	/**
	 * Write a signed 48-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeInt48BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_INT, 6);
	}

	/**
	 * Write a unsigned 48-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeUInt48BE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_UINT, 6);
	}

	/**
	 * Write a signed 64-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeBigInt64LE(value: bigint) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_INT, 8);
	}

	/**
	 * Write a unsigned 64-bit integer in little endian.
	 * @param value - The value to write.
	 */
	writeBigUInt64LE(value: bigint) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_BIG_UINT, 8);
	}

	/**
	 * Write a signed 64-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeBigInt64BE(value: bigint) {
		this._writeInt(value, BIG_ENDIAN.WRITE_BIG_INT, 8);
	}

	/**
	 * Write a unsigned 64-bit integer in big endian.
	 * @param value - The value to write.
	 */
	writeBigUInt64BE(value: bigint) {
		this._writeInt(value, BIG_ENDIAN.WRITE_BIG_UINT, 8);
	}

	/**
	 * Write a float in little endian.
	 * @param value - The value to write.
	 */
	writeFloatLE(value: number) {
		this._writeInt(value, LITTLE_ENDIAN.WRITE_FLOAT, 4);
	}

	/**
	 * Write a float in big endian.
	 * @param value - The value to write.
	 */
	writeFloatBE(value: number) {
		this._writeInt(value, BIG_ENDIAN.WRITE_FLOAT, 4);
	}

	/**
	 * Write the contents of a buffer to this buffer.
	 * @param buf - The buffer to write.
	 * @param copyLength - The number of bytes to copy. Defaults to the entire buffer.
	 */
	writeBuffer(buf: Buffer | BufferWrapper, copyLength: number = 0) {
		let startIndex: number = 0;
		let rawBuf: Buffer;

		// Unwrap the internal buffer if this is a wrapper.
		if (buf instanceof BufferWrapper) {
			startIndex = buf.offset;

			if (copyLength === 0)
				copyLength = buf.remainingBytes;
			else
				buf._checkBounds(copyLength);

			rawBuf = buf.raw;
		} else {
			rawBuf = buf;

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
	 *
	 * @remarks
	 * Directory path will be created if needed.
	 *
	 * @param file - The file to write to.
	 */
	async writeToFile(file: string) {
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, this._buf);
	}

	/**
	 * Get the index of the given char from start.
	 * @param char - The char to find.
	 * @param start - Defaults to the current reader offset.
	 *
	 * @throws {@link Error} If char is not a single character.
	 *
	 * @returns Index of the char, or -1 if not found.
	 */
	indexOfChar(char: string, start: number = this.offset): number {
		if (char.length > 1)
			throw new Error('BufferWrapper.indexOfChar() given string, expected single character.');

		return this.indexOf(char.charCodeAt(0), start);
	}

	/**
	 * Get the index of the given byte from start.
	 * @param byte - The byte to find.
	 * @param start - Defaults to the current reader offset.
	 * @returns Index of the byte, or -1 if not found.
	 */
	indexOf(byte: number, start: number = this.offset): number {
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
	 * @param context - The audio context to use.
	 * @returns Decoded audio buffer.
	 */
	async decodeAudio(context: AudioContext): Promise<AudioBuffer> {
		return await context.decodeAudioData(this._buf.buffer);
	}

	/**
	 * Assign a data URL for this buffer.
	 * @returns {string}
	 */
	getDataURL(): string {
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
	 * @returns Buffer encoded as base64.
	 */
	toBase64(): string {
		return this._buf.toString('base64');
	}

	/**
	 * Replace the internal buffer with a different capacity.
	 * If the specified capacity is lower than the current, there may be data loss.
	 * @param capacity - New capacity of the internal buffer.
	 * @param secure - If true, expanded capacity will be zeroed for security.
	 */
	setCapacity(capacity: number, secure: boolean = false) {
		// Don't waste time replacing the buffer for nothing.
		if (capacity === this.byteLength)
			return;

		const buf = secure ? Buffer.alloc(capacity) : Buffer.allocUnsafe(capacity);
		this._buf.copy(buf, 0, 0, Math.min(capacity, this.byteLength));
		this._buf = buf;
	}

	/**
	 * Calculate a hash of this buffer
	 * @param hash - Hashing method, defaults to 'md5'.
	 * @param encoding - Output encoding, defaults to 'hex'.
	 */
	calculateHash(hash: string = 'md5', encoding: crypto.BinaryToTextEncoding = 'hex') {
		return crypto.createHash(hash).update(this._buf).digest(encoding);
	}

	/**
	 * @returns True if all bytes are zero.
	 */
	isZeroed(): boolean {
		for (let i = 0, n = this.byteLength; i < n; i++) {
			if (this._buf[i] !== 0x0)
				return false;
		}

		return true;
	}

	/**
	 * @returns The CRC32 checksum for this buffer.
	 */
	getCRC32(): number {
		return crc32(this.raw);
	}

	/**
	 * @returns The contents of this buffer deflated as a new buffer.
	 */
	deflate(): BufferWrapper {
		return new BufferWrapper(zlib.deflateSync(this._buf));
	}

	/**
	 * Check a given length does not exceed current capacity.
	 * @param length - Length to check.
	 * @throws {@link Error} If the length exceeds the remaining capacity.
	 */
	_checkBounds(length: number) {
		if (this.remainingBytes < length)
			throw new Error(util.format('Buffer operation out-of-bounds: %d > %d', length, this.remainingBytes));
	}

	/**
	 * Read one or more integers from the buffer.
	 * @param count - How many integers to read.
	 * @param func - Buffer prototype function.
	 * @param byteLength - Byte-length of each integer.
	 * @throws {@link Error} If the length exceeds the remaining capacity.
	 * @returns The integer or array of integers.
	 */
	_readInt(count: number, func: BufferReadWriteFunc, byteLength: number): number | number[] {
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
	 * @param value - The integer to write.
	 * @param func - Buffer prototype function.
	 * @param byteLength - Byte-length of the integer to write.
	 * @throws {@link Error} If the length exceeds the remaining capacity.
	 */
	_writeInt(value: number|bigint, func: BufferReadWriteFunc, byteLength: number) {
		this._checkBounds(byteLength);

		func.call(this._buf, value, this._ofs, byteLength);
		this._ofs += byteLength;
	}
}