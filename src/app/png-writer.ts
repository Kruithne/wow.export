/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import zlib from 'node:zlib';
import BufferWrapper from './buffer';

const BITS_PER_PIXEL = 4;

type FilterFunction = (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number) => void;
type FilterSum = (data: Buffer, dataOfs: number, byteWidth: number) => number;

/** PNG filter functions. */
const FILTERS: Record<number, FilterFunction> = {
	/**
	 * Filter: None
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @param raw - The buffer to write the filtered data to.
	 * @param rawOfs - The offset into the raw buffer to start writing the filtered data.
	 */
	0: (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number): void => {
		for (let x = 0; x < byteWidth; x++)
			raw[rawOfs + x] = data[dataOfs + x];
	},

	/**
	 * Filter: Sub
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @param raw - The buffer to write the filtered data to.
	 * @param rawOfs - The offset into the raw buffer to start writing the filtered data.
	 */
	1: (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number): void => {
		for (let x = 0; x < byteWidth; x++) {
			const left = x >= BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const value = data[dataOfs + x] - left;

			raw[rawOfs + x] = value;
		}
	},

	/**
	 * Filter: Up
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @param raw - The buffer to write the filtered data to.
	 * @param rawOfs - The offset into the raw buffer to start writing the filtered data.
	 */
	2: (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number): void => {
		for (let x = 0; x < byteWidth; x++) {
			const up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			const value = data[dataOfs + x] - up;

			raw[rawOfs + x] = value;
		}
	},

	/**
	 * Filter: Average
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @param raw - The buffer to write the filtered data to.
	 * @param rawOfs - The offset into the raw buffer to start writing the filtered data.
	 */
	3: (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number) => {
		for (let x = 0; x < byteWidth; x++) {
			const left = x >= BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			const value = data[dataOfs + x] - ((left + up) >> 1);

			raw[rawOfs + x] = value;
		}
	},

	/**
	 * Filter: Paeth
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @param raw - The buffer to write the filtered data to.
	 * @param rawOfs - The offset into the raw buffer to start writing the filtered data.
	 */
	4: (data: Buffer, dataOfs: number, byteWidth: number, raw: Buffer, rawOfs: number) => {
		for (let x = 0; x < byteWidth; x++) {
			const left = x >= BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			const upLeft = dataOfs > 0 && x >= BITS_PER_PIXEL ? data[dataOfs + x - (byteWidth + BITS_PER_PIXEL)] : 0;
			const value = data[dataOfs + x] - paeth(left, up, upLeft);

			raw[rawOfs + x] = value;
		}
	}
};

/** The filter sums for each filter type. */
const FILTER_SUMS: Record<number, FilterSum> = {
	/**
	 * Filter: None
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @returns The sum of the absolute values of the filtered data.
	 */
	0: (data: Buffer, dataOfs: number, byteWidth: number): number => {
		let sum = 0;
		for (let i = dataOfs, len = dataOfs + byteWidth; i < len; i++)
			sum += Math.abs(data[i]);

		return sum;
	},

	/**
	 * Filter: Sub
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @returns The sum of the absolute values of the filtered data.
	 */
	1: (data: Buffer, dataOfs: number, byteWidth: number) => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			const left = x >= BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const value = data[dataOfs + x] - left;

			sum += Math.abs(value);
		}

		return sum;
	},

	/**
	 * Filter: Up
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @returns The sum of the absolute values of the filtered data.
	 */
	2: (data: Buffer, dataOfs: number, byteWidth: number): number => {
		let sum = 0;
		for (let x = dataOfs, len = dataOfs + byteWidth; x < len; x++) {
			const up = dataOfs > 0 ? data[x - byteWidth] : 0;
			const value = data[x] - up;

			sum += Math.abs(value);
		}

		return sum;
	},

	/**
	 * Filter: Average
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @returns The sum of the absolute values of the filtered data.
	 */
	3: (data: Buffer, dataOfs: number, byteWidth: number): number => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			const left = x > BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			const value = data[dataOfs + x] - ((left + up) >> 1);

			sum += Math.abs(value);
		}

		return sum;
	},

	/**
	 * Filter: Paeth
	 * @param data - The data to filter.
	 * @param dataOfs - The offset into the data to start filtering.
	 * @param byteWidth - The number of bytes to filter.
	 * @returns The sum of the absolute values of the filtered data.
	 */
	4: (data: Buffer, dataOfs: number, byteWidth: number): number => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			const left = x >= BITS_PER_PIXEL ? data[dataOfs + x - BITS_PER_PIXEL] : 0;
			const up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			const upLeft = dataOfs > 0 && x >= BITS_PER_PIXEL ? data[dataOfs + x - (byteWidth + BITS_PER_PIXEL)] : 0;
			const value = data[dataOfs + x] - paeth(left, up, upLeft);

			sum += Math.abs(value);
		}

		return sum;
	}
};

/**
 * Calculate the Paeth predictor.
 * @param left - The left pixel.
 * @param up - The up pixel.
 * @param upLeft - The up-left pixel.
 * @returns The Paeth predictor.
 */
const paeth = (left: number, up: number, upLeft: number): number => {
	const paeth = left + up - upLeft;
	const paethLeft = Math.abs(paeth - left);
	const paethUp = Math.abs(paeth - up);
	const paethUpLeft = Math.abs(paeth - upLeft);

	if (paethLeft <= paethUp && paethLeft <= paethUpLeft)
		return left;

	if (paethUp <= paethUpLeft)
		return up;

	return upLeft;
};

/**
 * Apply adapative filtering to RGBA data.
 * @param data - The data to filter.
 * @param width - The width of the image.
 * @param height - The height of the image.
 * @returns The filtered data.
 */
const filter = (data: Buffer, width: number, height: number): Buffer => {
	const byteWidth = width * BITS_PER_PIXEL;
	let dataOfs = 0;

	let rawOfs = 0;
	const raw = Buffer.alloc((byteWidth + 1) * height);

	let selectedFilter = 0;
	for (let y = 0; y < height; y++) {
		let min = Infinity;

		const filterCount = Object.keys(FILTERS).length;
		for (let i = 0, len = filterCount; i < len; i++) {
			const sum = FILTER_SUMS[i](data, dataOfs, byteWidth);
			if (sum < min) {
				selectedFilter = i;
				min = sum;
			}
		}

		raw[rawOfs] = selectedFilter;
		rawOfs++;

		FILTERS[selectedFilter](data, dataOfs, byteWidth, raw, rawOfs);
		rawOfs += byteWidth;
		dataOfs += byteWidth;
	}

	return raw;
};

export default class PNGWriter {
	width: number;
	height: number;
	data: Buffer;

	/**
	 * Construct a new PNGWriter instance.
	 * @param width - The width of the image.
	 * @param height - The height of the image.
	 */
	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.data = Buffer.alloc(width * height * 4);
	}

	/**
	 * Get the internal pixel data for this PNG.
	 */
	getPixelData(): Buffer {
		return this.data;
	}

	/**
	 * Render this PNG to a wrapped buffer.
	 * @returns BufferWrapper
	 */
	getBuffer(): BufferWrapper {
		const filtered = filter(this.data, this.width, this.height);
		const deflated = zlib.deflateSync(filtered);

		const buf = new BufferWrapper(Buffer.allocUnsafe(8 + 25 + deflated.length + 12 + 12));

		// 8-byte PNG signature.
		buf.writeUInt32(0x474E5089);
		buf.writeUInt32(0x0A1A0A0D);

		const ihdr = new BufferWrapper(Buffer.allocUnsafe(4 + 13));
		ihdr.writeUInt32(0x52444849); // IHDR
		ihdr.writeUInt32BE(this.width); // Image width
		ihdr.writeUInt32BE(this.height); // Image height
		ihdr.writeUInt8(8); // Bit-depth (1, 2, 4, 8, or 16)
		ihdr.writeUInt8(6); // Colour type (0 grayscale, 2 rgb, 3 indexed, 4 transparency, or 6 RGBA)
		ihdr.writeUInt8(0); // Compression (0)
		ihdr.writeUInt8(0); // Filter (0)
		ihdr.writeUInt8(0); // Interlace (0)

		buf.writeUInt32BE(13);
		buf.writeBuffer(ihdr.toBuffer());
		buf.writeInt32BE(ihdr.toCRC32());

		const idat = new BufferWrapper(Buffer.allocUnsafe(4 + deflated.length));
		idat.writeUInt32(0x54414449); // IDAT
		idat.writeBuffer(deflated);

		buf.writeUInt32BE(deflated.length);
		buf.writeBuffer(idat.toBuffer());
		buf.writeInt32BE(idat.toCRC32());

		buf.writeUInt32BE(0);
		buf.writeUInt32(0x444E4549); // IEND
		buf.writeUInt32(0x826042AE); // CRC IEND

		return buf;
	}

	/**
	 * Write this PNG to a file.
	 * @param file - The file to write to.
	 */
	async write(file: string): Promise<void> {
		return await this.getBuffer().writeToFile(file);
	}
}