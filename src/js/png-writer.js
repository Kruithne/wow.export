/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
//const fsp = require('fs').promises;
const BufferWrapper = require('./buffer');

class PNGWriter {
	/**
	 * Construct a new PNGWriter instance.
	 * @param {number} width
	 * @param {number} height
	 */
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.data = Array(width * height * 4);
	}

	/**
	 * Get the internal pixel data for this PNG.
	 */
	getPixelData() {
		return this.data;
	}

	/**
	 * Write this PNG to a file.
	 * @param {string} file 
	 */
	async write(file) {
		const pixelDataSize = this.data.length;
		const buf = BufferWrapper.alloc(8 + 25 + pixelDataSize + 12 + 12, false);

		// 8-byte PNG signature.
		buf.writeUInt32LE(0x474E5089);
		buf.writeUInt32LE(0x0A1A0A0D);

		const ihdr = BufferWrapper.alloc(4 + 13, false);
		ihdr.writeUInt32LE(0x52444849); // IHDR
		ihdr.writeUInt32BE(this.width); // Image width
		ihdr.writeUInt32BE(this.height); // Image height
		ihdr.writeUInt8(8); // Bit-depth (1, 2, 4, 8, or 16)
		ihdr.writeUInt8(6); // Colour type (0 grayscale, 2 rgb, 3 indexed, 4 transparency, or 6 RGBA)
		ihdr.writeUInt8(0); // Compression (0)
		ihdr.writeUInt8(0); // Filter (0)
		ihdr.writeUInt8(0); // Interlace (0)
		ihdr.seek(0);

		buf.writeUInt32BE(13);
		buf.writeBuffer(ihdr);
		buf.writeInt32BE(ihdr.getCRC32());

		const idat = BufferWrapper.alloc(4 + pixelDataSize, false);
		idat.writeUInt32LE(0x54414449); // IDAT
		for (const value of this.data)
			idat.writeUInt8(value);

		idat.seek(0);

		buf.writeUInt32BE(pixelDataSize);
		buf.writeBuffer(idat);
		buf.writeInt32BE(idat.getCRC32());

		buf.writeUInt32BE(0);
		buf.writeUInt32LE(0x444E4549); // IEND
		buf.writeUInt32LE(0x826042AE); // CRC IEND

		await buf.writeToFile(file);
	}
}

module.exports = PNGWriter;