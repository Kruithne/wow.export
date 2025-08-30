/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const BufferWrapper = require('./buffer');

const FILTERS = {
	// None
	0: (data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel) => {
		for (let x = 0; x < byteWidth; x++)
			raw[rawOfs + x] = data[dataOfs + x];
	},

	// Sub
	1: (data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel) => {
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let value = data[dataOfs + x] - left;

			raw[rawOfs + x] = value;
		}
	},

	// Up
	2: (data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel) => {
		for (let x = 0; x < byteWidth; x++) {
			let up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			let value = data[dataOfs + x] - up;

			raw[rawOfs + x] = value;
		}
	},

	// Average
	3: (data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel) => {
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			let value = data[dataOfs + x] - ((left + up) >> 1);

			raw[rawOfs + x] = value;
		}
	},

	// Paeth
	4: (data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel) => {
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			let upLeft = dataOfs > 0 && x >= bytesPerPixel ? data[dataOfs + x - (byteWidth + bytesPerPixel)] : 0;
			let value = data[dataOfs + x] - paeth(left, up, upLeft);

			raw[rawOfs + x] = value;
		}
	}
};

const FILTER_SUMS = {
	// None
	0: (data, dataOfs, byteWidth, bytesPerPixel) => {
		let sum = 0;
		for (let i = dataOfs, len = dataOfs + byteWidth; i < len; i++)
			sum += Math.abs(data[i]);

		return sum;
	},

	// Sub
	1: (data, dataOfs, byteWidth, bytesPerPixel) => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let value = data[dataOfs + x] - left;

			sum += Math.abs(value);
		}

		return sum;
	},

	// Up
	2: (data, dataOfs, byteWidth, bytesPerPixel) => {
		let sum = 0;
		for (let x = dataOfs, len = dataOfs + byteWidth; x < len; x++) {
			let up = dataOfs > 0 ? data[x - byteWidth] : 0;
			let value = data[x] - up;

			sum += Math.abs(value);
		}

		return sum;
	},

	// Average
	3: (data, dataOfs, byteWidth, bytesPerPixel) => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			let value = data[dataOfs + x] - ((left + up) >> 1);

			sum += Math.abs(value);
		}

		return sum;
	},

	// Paeth
	4: (data, dataOfs, byteWidth, bytesPerPixel) => {
		let sum = 0;
		for (let x = 0; x < byteWidth; x++) {
			let left = x >= bytesPerPixel ? data[dataOfs + x - bytesPerPixel] : 0;
			let up = dataOfs > 0 ? data[dataOfs + x - byteWidth] : 0;
			let upLeft = dataOfs > 0 && x >= bytesPerPixel ? data[dataOfs + x - (byteWidth + bytesPerPixel)] : 0;
			let value = data[dataOfs + x] - paeth(left, up, upLeft);

			sum += Math.abs(value);
		}

		return sum;
	}
};

const paeth = (left, up, upLeft) => {
	let paeth = left + up - upLeft;
	let paethLeft = Math.abs(paeth - left);
	let paethUp = Math.abs(paeth - up);
	let paethUpLeft = Math.abs(paeth - upLeft);

	if (paethLeft <= paethUp && paethLeft <= paethUpLeft)
		return left;

	if (paethUp <= paethUpLeft)
		return up;

	return upLeft;
};

/**
 * Apply adaptive filtering to image data.
 * @param {Buffer} data 
 * @param {number} width 
 * @param {number} height 
 * @param {number} bytesPerPixel
 * @returns {Buffer}
 */
const filter = (data, width, height, bytesPerPixel) => {
	let byteWidth = width * bytesPerPixel;
	let dataOfs = 0;

	let rawOfs = 0;
	let raw = Buffer.alloc((byteWidth + 1) * height);

	let selectedFilter = 0;
	for (let y = 0; y < height; y++) {
		let min = Infinity;

		for (let i = 0, len = Object.keys(FILTERS).length; i < len; i++) {
			let sum = FILTER_SUMS[i](data, dataOfs, byteWidth, bytesPerPixel);
			if (sum < min) {
				selectedFilter = i;
				min = sum;
			}
		}

		raw[rawOfs] = selectedFilter;
		rawOfs++;
	
		FILTERS[selectedFilter](data, dataOfs, byteWidth, raw, rawOfs, bytesPerPixel);
		rawOfs += byteWidth;
		dataOfs += byteWidth;
	}
	return raw;
};

class PNGWriter {
	/**
	 * Construct a new PNGWriter instance.
	 * @param {number} width
	 * @param {number} height
	 */
	constructor(width, height) {
		this.width = width;
		this.height = height;
		this.bytesPerPixel = 4;
		this.bitDepth = 8;
		this.colorType = 6; // RGBA
		this.data = Buffer.alloc(width * height * 4);
	}

	/**
	 * Get the internal pixel data for this PNG.
	 */
	getPixelData() {
		return this.data;
	}

	/**
	 * @returns {BufferWrapper}
	 */
	getBuffer() {
		const filtered = new BufferWrapper(filter(this.data, this.width, this.height, this.bytesPerPixel));
		const deflated = filtered.deflate();
		const buf = BufferWrapper.alloc(8 + 25 + deflated.byteLength + 12 + 12, false);

		// 8-byte PNG signature.
		buf.writeUInt32LE(0x474E5089);
		buf.writeUInt32LE(0x0A1A0A0D);

		const ihdr = BufferWrapper.alloc(4 + 13, false);
		ihdr.writeUInt32LE(0x52444849); // IHDR
		ihdr.writeUInt32BE(this.width); // Image width
		ihdr.writeUInt32BE(this.height); // Image height
		ihdr.writeUInt8(this.bitDepth); // Bit-depth
		ihdr.writeUInt8(this.colorType); // Colour type
		ihdr.writeUInt8(0); // Compression (0)
		ihdr.writeUInt8(0); // Filter (0)
		ihdr.writeUInt8(0); // Interlace (0)
		ihdr.seek(0);

		buf.writeUInt32BE(13);
		buf.writeBuffer(ihdr);
		buf.writeInt32BE(ihdr.getCRC32());

		const idat = BufferWrapper.alloc(4 + deflated.byteLength, false);
		idat.writeUInt32LE(0x54414449); // IDAT
		idat.writeBuffer(deflated);

		idat.seek(0);

		buf.writeUInt32BE(deflated.byteLength);
		buf.writeBuffer(idat);
		buf.writeInt32BE(idat.getCRC32());

		buf.writeUInt32BE(0);
		buf.writeUInt32LE(0x444E4549); // IEND
		buf.writeUInt32LE(0x826042AE); // CRC IEND

		return buf;
	}

	/**
	 * Write this PNG to a file.
	 * @param {string} file 
	 */
	async write(file) {
		return await this.getBuffer().writeToFile(file);
	}
}

module.exports = PNGWriter;