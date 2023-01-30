/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import crc32 from './crc32';

const IS_DEBUG_BUILD = process.env.NODE_ENV === 'development';

/**
 * @param canvas - Canvas element to create the buffer from.
 * @param mimeType - MIME type of the canvas data.
 * @returns The created buffer.
 */
export async function canvasToBuffer(canvas: HTMLCanvasElement | OffscreenCanvas, mimeType: string): Promise<ArrayBuffer> {
	let blob: Blob;
	if (canvas instanceof OffscreenCanvas)
		blob = await canvas.convertToBlob({ type: mimeType });
	else
		blob = await new Promise(res => canvas.toBlob(res as BlobCallback, mimeType));

	return blob.arrayBuffer();
}

export default class BufferWrapper {
	buffer: Buffer;
	offset: number = 0;
	dataURL: string | undefined;

	/**
	 * Create a new BufferWrapper.
	 * @param buffer - Buffer to read from.
	 */
	constructor(buffer: Buffer | ArrayBuffer) {
		this.buffer = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : buffer;
	}

	/** @returns The internal ArrayBuffer of the buffer. */
	toArrayBuffer(): ArrayBuffer {
		return this.buffer.buffer;
	}

	toBlob(): Blob {
		return new Blob([this.buffer]);
	}

	/** @returns The internal Node.js Buffer. */
	toBuffer(): Buffer {
		return this.buffer;
	}

	/**
	 * Calculate a hash of this buffer
	 * @param algorithm - Hashing algorithm (default 'md5').
	 * @param encoding - Output encoding (default 'hex')
	 * @returns The calculated hash.
	 */
	toHash(algorithm: string = 'md5', encoding: crypto.BinaryToTextEncoding = 'hex'): string {
		return crypto.createHash(algorithm).update(this.buffer).digest(encoding);
	}

	/** @returns The calculated CRC32 hash. */
	toCRC32(): number {
		return crc32(this.buffer);
	}

	/** @returns The length of the buffer. */
	get length(): number {
		return this.buffer.length;
	}

	/** @returns The remaining bytes until the end of the buffer. */
	get remainingBytes(): number {
		return this.length - this.offset;
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
		const pos = ofs < 0 ? this.length + ofs : ofs;
		if (pos < 0 || pos > this.length)
			throw new Error(util.format('seek() offset out of bounds %d -> %d ! %d', ofs, pos, this.length));

		this.offset = pos;
	}

	/**
	 * Shift the position of the buffer relative to its current position.
	 *
	 * @remarks
	 * Positive numbers seek forward, negative seek backwards.
	 *
	 * @param ofs - Offset to move the position by.
	 * @throws {@link Error} If the new position is out of bounds of the buffer.
	 */
	move(ofs: number) {
		const pos = this.offset + ofs;
		if (pos < 0 || pos > this.length)
			throw new Error(util.format('move() offset out of bounds %d -> %d ! %d', ofs, pos, this.length));

		this.offset = pos;
	}

	/** @returns Signed 8-bit integer at the current position. */
	readInt8(): number {
		return this.buffer.readInt8(this.offset++);
	}

	/** @returns Unsigned 8-bit integer at the current position. */
	readUInt8(): number {
		return this.buffer.readUInt8(this.offset++);
	}

	/** @returns Signed 16-bit integer (little-endian) at the current position. */
	readInt16(): number {
		const val = this.buffer.readInt16LE(this.offset);
		this.offset += 2;
		return val;
	}

	/** @returns Unsigned 16-bit integer (little-endian) at the current position. */
	readUInt16(): number {
		const val = this.buffer.readUInt16LE(this.offset);
		this.offset += 2;
		return val;
	}

	/** @returns Signed 24-bit integer (little-endian) at the current position. */
	readInt24(): number {
		const val = this.buffer.readIntLE(this.offset, 3);
		this.offset += 3;
		return val;
	}

	/** @returns Unsigned 24-bit integer (little-endian) at the current position. */
	readUInt24(): number {
		const val = this.buffer.readUIntLE(this.offset, 3);
		this.offset += 3;
		return val;
	}

	/** @returns Signed 32-bit integer (little-endian) at the current position. */
	readInt32(): number {
		const val = this.buffer.readInt32LE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Unsigned 32-bit integer (little-endian) at the current position. */
	readUInt32(): number {
		const val = this.buffer.readUInt32LE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Signed 40-bit integer (little-endian) at the current position. */
	readInt40(): number {
		const val = this.buffer.readIntLE(this.offset, 5);

		this.offset += 5;
		return val;
	}

	/** @returns Unsigned 40-bit integer (little-endian) at the current position. */
	readUInt40(): number {
		const val = this.buffer.readUIntLE(this.offset, 5);

		this.offset += 5;
		return val;
	}

	/** @returns Signed 64-bit integer (little-endian) at the current position. */
	readInt64(): bigint {
		const val = this.buffer.readBigInt64LE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Unsigned 64-bit integer (little-endian) at the current position. */
	readUInt64(): bigint {
		const val = this.buffer.readBigUInt64LE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Float (little-endian) at the current position. */
	readFloat(): number {
		const val = this.buffer.readFloatLE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Double (little-endian) at the current position. */
	readDouble(): number {
		const val = this.buffer.readDoubleLE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Signed 16-bit integer (big-endian) at the current position. */
	readInt16BE(): number {
		const val = this.buffer.readInt16BE(this.offset);
		this.offset += 2;
		return val;
	}

	/** @returns Unsigned 16-bit integer (big-endian) at the current position. */
	readUInt16BE(): number {
		const val = this.buffer.readUInt16BE(this.offset);
		this.offset += 2;
		return val;
	}

	/** @returns Signed 24-bit integer (big-endian) at the current position. */
	readInt24BE(): number {
		const val = this.buffer.readIntBE(this.offset, 3);
		this.offset += 3;
		return val;
	}

	/** @returns Unsigned 24-bit integer (big-endian) at the current position. */
	readUInt24BE(): number {
		const val = this.buffer.readUIntBE(this.offset, 3);
		this.offset += 3;
		return val;
	}

	/** @returns Signed 32-bit integer (big-endian) at the current position. */
	readInt32BE(): number {
		const val = this.buffer.readInt32BE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Unsigned 32-bit integer (big-endian) at the current position. */
	readUInt32BE(): number {
		const val = this.buffer.readUInt32BE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Signed 40-bit integer (big-endian) at the current position. */
	readInt40BE(): number {
		const val = this.buffer.readIntBE(this.offset, 5);
		this.offset += 5;
		return val;
	}

	/** @returns Unsigned 40-bit integer (big-endian) at the current position. */
	readUInt40BE(): number {
		const val = this.buffer.readUIntBE(this.offset, 5);
		this.offset += 5;
		return val;
	}

	/** @returns Signed 64-bit integer (big-endian) at the current position. */
	readInt64BE(): bigint {
		const val = this.buffer.readBigInt64BE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Unsigned 64-bit integer (big-endian) at the current position. */
	readUInt64BE(): bigint {
		const val = this.buffer.readBigUInt64BE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Float (big-endian) at the current position. */
	readFloatBE(): number {
		const val = this.buffer.readFloatBE(this.offset);
		this.offset += 4;
		return val;
	}

	/** @returns Double (big-endian) at the current position. */
	readDoubleBE(): number {
		const val = this.buffer.readDoubleBE(this.offset);
		this.offset += 8;
		return val;
	}

	/** @returns Array of signed 16-bit integers (little-endian) at the current position. */
	readInt16Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readInt16LE(this.offset + i * 2);

		this.offset += length * 2;
		return arr;
	}

	/** @returns Array of unsigned 16-bit integers (little-endian) at the current position. */
	readUInt16Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUInt16LE(this.offset + i * 2);

		this.offset += length * 2;
		return arr;
	}

	/** @returns Array of signed 24-bit integers (little-endian) at the current position. */
	readInt24Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readIntLE(this.offset, 3);

		this.offset += length * 3;
		return arr;
	}

	/** @returns Array of unsigned 24-bit integers (little-endian) at the current position. */
	readUInt24Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUIntLE(this.offset, 3);

		this.offset += length * 3;
		return arr;
	}

	/** @returns Array of signed 32-bit integers (little-endian) at the current position. */
	readInt32Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readInt32LE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of unsigned 32-bit integers (little-endian) at the current position. */
	readUInt32Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUInt32LE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of signed 64-bit integers (little-endian) at the current position. */
	readInt64Array(length: number): bigint[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readBigInt64LE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/** @returns Array of unsigned 64-bit integers (little-endian) at the current position. */
	readUInt64Array(length: number): bigint[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readBigUInt64LE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/** @returns Array of 32-bit floats (little-endian) at the current position. */
	readFloat32Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readFloatLE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of 64-bit floats (little-endian) at the current position. */
	readFloat64Array(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readDoubleLE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/** @returns Array of signed 8-bit integers (big-endian) at the current position. */
	readInt8BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readInt8(this.offset + i);

		this.offset += length;
		return arr;
	}

	/** @returns Array of unsigned 8-bit integers (big-endian) at the current position. */
	readUInt8BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUInt8(this.offset + i);

		this.offset += length;
		return arr;
	}

	/** @returns Array of signed 16-bit integers (big-endian) at the current position. */
	readInt16BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readInt16BE(this.offset + i * 2);

		this.offset += length * 2;
		return arr;
	}

	/** @returns Array of unsigned 16-bit integers (big-endian) at the current position. */
	readUInt16BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUInt16BE(this.offset + i * 2);

		this.offset += length * 2;
		return arr;
	}

	/** @returns Array of signed 32-bit integers (big-endian) at the current position. */
	readInt32BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readInt32BE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of unsigned 32-bit integers (big-endian) at the current position. */
	readUInt32BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readUInt32BE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of signed 64-bit integers (big-endian) at the current position. */
	readInt64BEArray(length: number): bigint[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readBigInt64BE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/** @returns Array of unsigned 64-bit integers (big-endian) at the current position. */
	readUInt64BEArray(length: number): bigint[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readBigUInt64BE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/** @returns Array of 32-bit floats (big-endian) at the current position. */
	readFloat32BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readFloatBE(this.offset + i * 4);

		this.offset += length * 4;
		return arr;
	}

	/** @returns Array of 64-bit floats (big-endian) at the current position. */
	readFloat64BEArray(length: number): number[] {
		const arr = new Array(length);
		for (let i = 0; i < length; i++)
			arr[i] = this.buffer.readDoubleBE(this.offset + i * 8);

		this.offset += length * 8;
		return arr;
	}

	/**
	 * Read a string of variable byte length.
	 * @param length - How many bytes to read. If not specified, reads until the end of the buffer.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns String at the current position.
	 */
	readString(length: number = this.remainingBytes, encoding?: BufferEncoding): string {
		// Don't read empty strings.
		if (length === 0)
			return '';

		if (this.remainingBytes < length)
			throw new Error(util.format('BufferWrapper.readString(%d) out-of-bounds [> %d]', length, this.remainingBytes));

		const val = this.buffer.toString(encoding, this.offset, this.offset + length);
		this.offset += length;
		return val;
	}

	/**
	 * Read a buffer from this buffer.
	 * @param length How many bytes to read into the buffer.
	 * @returns Buffer at the current position.
	 */
	readBuffer(length: number = this.remainingBytes): Buffer {
		if (this.remainingBytes < length)
			throw new Error(util.format('BufferWrapper.readBuffer(%d) out-of-bounds [> %d]', length, this.remainingBytes));

		const slice = Buffer.allocUnsafe(length);
		this.buffer.copy(slice, 0, this.offset, this.offset + length);
		this.offset += length;

		return slice;
	}

	/**
	 * Read a buffer wrapped in a BufferWrapper.
	 * @param length How many bytes to read into the buffer.
	 * @returns BufferWrapper at the current position.
	 */
	readBufferWrapper(length: number = this.remainingBytes): BufferWrapper {
		return new BufferWrapper(this.readBuffer(length));
	}

	/**
	 * Read a null-terminated string from the buffer.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns The read string.
	 */
	readNullTerminatedString(encoding?: BufferEncoding): string {
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

	/** Write a 8-bit integer to the buffer. */
	writeInt8(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 1)
			throw new Error(util.format('BufferWrapper.writeInt8(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeInt8(value, this.offset);
		this.offset += 1;
	}

	/** Write a 8-bit unsigned integer to the buffer. */
	writeUInt8(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 1)
			throw new Error(util.format('BufferWrapper.writeUInt8(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeUInt8(value, this.offset);
		this.offset += 1;
	}

	/** Write a 16-bit (little-endian) signed integer to the buffer. */
	writeInt16(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 2)
			throw new Error(util.format('BufferWrapper.writeInt16(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeInt16LE(value, this.offset);
		this.offset += 2;
	}

	/** Write a 16-bit (little-endian) unsigned integer to the buffer. */
	writeUInt16(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 2)
			throw new Error(util.format('BufferWrapper.writeUInt16(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeUInt16LE(value, this.offset);
		this.offset += 2;
	}

	/** Write a 32-bit (little-endian) signed integer to the buffer. */
	writeInt32(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeInt32(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeInt32LE(value, this.offset);
		this.offset += 4;
	}

	/** Write a 32-bit (little-endian) unsigned integer to the buffer. */
	writeUInt32(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeUInt32(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeUInt32LE(value, this.offset);
		this.offset += 4;
	}

	/** Write a 64-bit (little-endian) signed integer to the buffer. */
	writeInt64(value: bigint) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeInt64(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeBigInt64LE(value, this.offset);
		this.offset += 8;
	}

	/** Write a 64-bit (little-endian) unsigned integer to the buffer. */
	writeUInt64(value: bigint) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeUInt64(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeBigUInt64LE(value, this.offset);
		this.offset += 8;
	}

	/** Write a float (little-endian) to the buffer. */
	writeFloat(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeFloat(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeFloatLE(value, this.offset);
		this.offset += 4;
	}

	/** Write a double (little-endian) to the buffer. */
	writeDouble(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeFloat64(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeDoubleLE(value, this.offset);
		this.offset += 8;
	}

	/** Write a 16-bit (big-endian) signed integer to the buffer. */
	writeInt16BE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 2)
			throw new Error(util.format('BufferWrapper.writeInt16BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeInt16BE(value, this.offset);
		this.offset += 2;
	}

	/** Write a 16-bit (big-endian) unsigned integer to the buffer. */
	writeUInt16BE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 2)
			throw new Error(util.format('BufferWrapper.writeUInt16BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeUInt16BE(value, this.offset);
		this.offset += 2;
	}

	/** Write a 32-bit (big-endian) signed integer to the buffer. */
	writeInt32BE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeInt32BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeInt32BE(value, this.offset);
		this.offset += 4;
	}

	/** Write a 32-bit (big-endian) unsigned integer to the buffer. */
	writeUInt32BE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeUInt32BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeUInt32BE(value, this.offset);
		this.offset += 4;
	}

	/** Write a 64-bit (big-endian) signed integer to the buffer. */
	writeInt64BE(value: bigint) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeInt64BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeBigInt64BE(value, this.offset);
		this.offset += 8;
	}

	/** Write a 64-bit (big-endian) unsigned integer to the buffer. */
	writeUInt64BE(value: bigint) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeUInt64BE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeBigUInt64BE(value, this.offset);
		this.offset += 8;
	}

	/** Write a float (big-endian) to the buffer. */
	writeFloatBE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 4)
			throw new Error(util.format('BufferWrapper.writeFloatBE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeFloatBE(value, this.offset);
		this.offset += 4;
	}

	/** Write a double (big-endian) to the buffer. */
	writeDoubleBE(value: number) {
		if (IS_DEBUG_BUILD && this.remainingBytes < 8)
			throw new Error(util.format('BufferWrapper.writeDoubleBE(%d) out-of-bounds [> %d]', value, this.remainingBytes));

		this.buffer.writeDoubleBE(value, this.offset);
		this.offset += 8;
	}

	/**
	 * Write the contents of a buffer to this buffer.
	 * @param source - The buffer to write.
	 * @param copyOfs - The offset to start copying from. Defaults to 0.
	 * @param copyLength - The number of bytes to copy. Defaults to the entire buffer.
	 */
	writeBuffer(source: Buffer, copyOfs = 0, copyLength: number = 0) {
		if (copyLength === 0)
			copyLength = source.byteLength;

		if (this.remainingBytes < copyLength)
			throw new Error(util.format('BufferWrapper.writeBuffer(%d) out-of-bounds [> %d]', copyLength, this.remainingBytes));

		source.copy(this.buffer, this.offset, copyOfs, copyOfs + copyLength);
		this.offset += copyLength;
	}

	/**
	 * Write the contents of this buffer to a file.
	 * @param file - The file to write to.
	 */
	async writeToFile(file: string) {
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(file, this.buffer);
	}

	/**
	 * Check if the buffer starts with the given string.
	 * @param input - The string to check for.
	 * @param encoding - The encoding to use (default: utf8)
	 * @returns True if the buffer starts with the given string.
	 */
	startsWith(input: string, encoding?: BufferEncoding): boolean {
		this.seek(0);
		return this.readString(input.length, encoding) === input;
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
	 * Assign a data URL for this buffer.
	 * @returns {string}
	 */
	getDataURL(): string {
		if (this.dataURL !== undefined)
			this.dataURL = URL.createObjectURL(this.toBlob());

		return this.dataURL;
	}

	/**
	 * Revoke the data URL assigned to this buffer.
	 */
	revokeDataURL() {
		if (this.dataURL !== undefined) {
			URL.revokeObjectURL(this.dataURL);
			this.dataURL = undefined;
		}
	}
}