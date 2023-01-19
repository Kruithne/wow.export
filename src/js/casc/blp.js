/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const BufferWrapper = require('../buffer');
const PNGWriter = require('../png-writer');

const DXT1 = 0x1;
const DXT3 = 0x2;
const DXT5 = 0x4;

const BLP_MAGIC = 0x32504c42;

/**
 * Unpack a colour value.
 * @param {Array} block
 * @param {number} index
 * @param {number} ofs
 * @param {Array} colour
 * @param {number} colourOfs
 * @private
 */
const unpackColour = (block, index, ofs, colour, colourOfs) => {
	let value = block[index + ofs] | (block[index + 1 + ofs] << 8);

	let r = (value >> 11) & 0x1F;
	let g = (value >> 5) & 0x3F;
	let b = value & 0x1F;

	colour[colourOfs] = (r << 3) | (r >> 2);
	colour[colourOfs + 1] = (g << 2) | (g >> 4);
	colour[colourOfs + 2] = (b << 3) | (b >> 2);
	colour[colourOfs + 3] = 255;

	return value;
};

class BLPImage {
	/**
	 * Construct a new BLPImage instance.
	 * @param {BufferWrapper}
	 */
	constructor(data) {
		this.data = data;

		// Check magic value..
		if (this.data.readUInt32LE() !== BLP_MAGIC)
			throw new Error('Provided data is not a BLP file (invalid header magic).');

		// Check the BLP file type..
		let type = this.data.readUInt32LE();
		if (type !== 1)
			throw new Error('Unsupported BLP type: ' + type);

		// Read file flags..
		this.encoding = this.data.readUInt8();
		this.alphaDepth = this.data.readUInt8();
		this.alphaEncoding = this.data.readUInt8();
		this.containsMipmaps = this.data.readUInt8();

		// Read file dimensions..
		this.width = this.data.readUInt32LE();
		this.height = this.data.readUInt32LE();

		// Read mipmap data..
		this.mapOffsets = this.data.readUInt32LE(16);
		this.mapSizes = this.data.readUInt32LE(16);

		// Calculate available mipmaps..
		this.mapCount = 0;
		for (let ofs of this.mapOffsets) {
			if (ofs !== 0)
				this.mapCount++;
		}

		// Read colour palette..
		this.palette = [];
		if (this.encoding === 1) {
			for (let i = 0; i < 256; i++)
				this.palette[i] = this.data.readUInt8(4);
		}

		this.dataURL = null;
	}

	/**
	 * Encode this image as a data URL and return it.
	 * @param {number} mask
	 * @returns {string}
	 */
	getDataURL(mask = 0b1111) {
		return this.toCanvas(mask).toDataURL();
	}

	/**
	 * Return a canvas with this BLP painted onto it.
	 * @param {number} mask
	 */
	toCanvas(mask = 0b1111) {
		const canvas = document.createElement('canvas');
		canvas.width = this.width;
		canvas.height = this.height;

		this.drawToCanvas(canvas, 0, mask);
		return canvas;
	}

	/**
	 * Retrieve this BLP as a PNG image.
	 * @param {number} mask
	 * @param {number} mipmap
	 * @returns {BufferWrapper}
	 */
	toPNG(mask = 0b1111, mipmap = 0) {
		this._prepare(mipmap);

		const png = new PNGWriter(this.scaledWidth, this.scaledHeight);
		const pixelData = png.getPixelData();

		switch (this.encoding) {
		case 1: this._getUncompressed(pixelData, mask); break;
		case 2: this._getCompressed(pixelData, mask); break;
		case 3: this._marshalBGRA(pixelData, mask); break;
		}

		return png.getBuffer();
	}

	/**
	 * Save this BLP as PNG file.
	 * @param {string} file
	 * @param {number} mask
	 * @param {number} mipmap
	 */
	async saveToPNG(file, mask = 0b1111, mipmap = 0) {
		return await this.toPNG(mask, mipmap).writeToFile(file);
	}

	/**
	 * Prepare BLP for processing.
	 * @param {number} mipmap
	 */
	_prepare(mipmap = 0) {
		// Constrict the requested mipmap to a valid range..
		mipmap = Math.max(0, Math.min(mipmap || 0, this.mapCount - 1));

		// Calculate the scaled dimensions..
		this.scale = Math.pow(2, mipmap);
		this.scaledWidth = this.width / this.scale;
		this.scaledHeight = this.height / this.scale;
		this.scaledLength = this.scaledWidth * this.scaledHeight;

		// Extract the raw data we need..
		this.data.seek(this.mapOffsets[mipmap]);
		this.rawData = this.data.readUInt8(this.mapSizes[mipmap]);
	}

	/**
	 * Draw the contents of this BLP file onto a canvas.
	 * @param {HTMLElement} canvas
	 * @param {number} mipmap
	 * @param {number} mask
	 */
	drawToCanvas(canvas, mipmap = 0, mask = 0b1111) {
		this._prepare(mipmap);

		const ctx = canvas.getContext('2d');
		const canvasData = ctx.createImageData(this.scaledWidth, this.scaledHeight);

		switch (this.encoding) {
		case 1: this._getUncompressed(canvasData.data, mask); break;
		case 2: this._getCompressed(canvasData.data, mask); break;
		case 3: this._marshalBGRA(canvasData.data, mask); break;
		}

		ctx.putImageData(canvasData, 0, 0);
	}

	/**
	 * Get the contents of this BLP as a BufferWrapper instance.
	 * @param {number} mipmap
	 * @param {number} mask
	 * @returns {BufferWrapper}
	 */
	toBuffer(mipmap = 0, mask = 0b1111) {
		this._prepare(mipmap);

		switch (this.encoding) {
		case 1: return this._getUncompressed(null, mask);
		case 2: return this._getCompressed(null, mask);
		case 3: return this._marshalBGRA(null, mask);
		}
	}

	/**
	 * Get the contents of this BLP as an RGBA UInt8 array.
	 * @param {number} mipmap
	 * @param {number} mask
	 */
	toUInt8Array(mipmap = 0, mask = 0b1111) {
		this._prepare(mipmap);

		const arr = new Uint8Array(this.scaledWidth * this.scaledHeight * 4);
		switch (this.encoding) {
		case 1: this._getUncompressed(arr, mask); break;
		case 2: this._getCompressed(arr, mask); break;
		case 3: this._marshalBGRA(arr, mask); break;
		}

		return arr;
	}

	/**
	 * Calculate the alpha using this files alpha depth.
	 * @param {number} index Alpha index.
	 * @private
	 */
	_getAlpha(index) {
		let byte;
		switch (this.alphaDepth) {
		case 1:
			byte = this.rawData[this.scaledLength + (index / 8)];
			return (byte & (0x01 << (index % 8))) === 0 ? 0x00 : 0xFF;

		case 4:
			byte = this.rawData[this.scaledLength + (index / 2)];
			return (index % 2 === 0 ? (byte & 0x0F) << 4 : byte & 0xF0);

		case 8:
			return this.rawData[this.scaledLength + index];

		default:
			return 0xFF;
		}
	}

	/**
	 * Extract compressed data.
	 * @param {ImageData} canvasData
	 * @param {number} mask
	 * @private
	 */
	_getCompressed(canvasData, mask = 0b1111) {
		const flags = this.alphaDepth > 1 ? (this.alphaEncoding === 7 ? DXT5 : DXT3) : DXT1;
		const data = canvasData ? canvasData : Buffer.alloc(this.scaledWidth * this.scaledHeight * 4);

		let pos = 0;
		const blockBytes = (flags & DXT1) !== 0 ? 8 : 16;
		const target = new Array(4 * 16);

		for (let y = 0, sh = this.scaledHeight; y < sh; y += 4) {
			for (let x = 0, sw = this.scaledWidth; x < sw; x+= 4) {
				let blockPos = 0;

				if (this.rawData.length === pos)
					continue;

				let colourIndex = pos;
				if ((flags & (DXT3 | DXT5)) !== 0)
					colourIndex += 8;

				// Decompress colour..
				let isDXT1 = (flags & DXT1) !== 0;
				let colours = [];
				let a = unpackColour(this.rawData, colourIndex, 0, colours, 0);
				let b = unpackColour(this.rawData, colourIndex, 2, colours, 4);

				for (let i = 0; i < 3; i++) {
					let c = colours[i];
					let d = colours[i + 4];

					if (isDXT1 && a <= b) {
						colours[i + 8] = (c + d) / 2;
						colours[i + 12] = 0;
					} else {
						colours[i + 8] = (2 * c + d) / 3;
						colours[i + 12] = (c + 2 * d) / 3;
					}
				}

				colours[8 + 3] = 255;
				colours[12 + 3] = (isDXT1 && a <= b) ? 0 : 255;

				let index = [];
				for (let i = 0; i < 4; i++) {
					let packed = this.rawData[colourIndex + 4 + i];
					index[i * 4] = packed & 0x3;
					index[1 + i * 4] = (packed >> 2) & 0x3;
					index[2 + i * 4] = (packed >> 4) & 0x3;
					index[3 + i * 4] = (packed >> 6) & 0x3;
				}

				for (let i = 0; i < 16; i++) {
					let ofs = index[i] * 4;
					target[4 * i] = colours[ofs];
					target[4 * i + 1] = colours[ofs + 1];
					target[4 * i + 2] = colours[ofs + 2];
					target[4 * i + 3] = colours[ofs + 3];
				}

				if ((flags & DXT3) !== 0) {
					for (let i = 0; i < 8; i++) {
						let quant = this.rawData[pos + i];

						let low = (quant & 0x0F);
						let high = (quant & 0xF0);

						target[8 * i + 3] = (low | (low << 4));
						target[8 * i + 7] = (high | (high >> 4));
					}
				} else if ((flags & DXT5) !== 0) {
					let a0 = this.rawData[pos];
					let a1 = this.rawData[pos + 1];

					let colours = [];
					colours[0] = a0;
					colours[1] = a1;

					if (a0 <= a1) {
						for (let i = 1; i < 5; i++)
							colours[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;

						colours[6] = 0;
						colours[7] = 255;
					} else {
						for (let i = 1; i < 7; i++)
							colours[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
					}

					let indices = [];
					let blockPos = 2;
					let indicesPos = 0;

					for (let i = 0; i < 2; i++) {
						let value = 0;
						for (let j = 0; j < 3; j++) {
							let byte = this.rawData[pos + blockPos++];
							value |= (byte << 8 * j);
						}

						for (let j = 0; j < 8; j++)
							indices[indicesPos++] = (value >> 3 * j) & 0x07;
					}

					for (let i = 0; i < 16; i++)
						target[4 * i + 3] = colours[indices[i]];
				}

				for (let pY = 0; pY < 4; pY++) {
					for (let pX = 0; pX < 4; pX++) {
						let sX = x + pX;
						let sY = y + pY;

						if (sX < sw && sY < sh) {
							let pixel = 4 * (sw * sY + sX);
							data[pixel + 0] = (mask & 0b1) ? target[blockPos + 0] : 0;
							data[pixel + 1] = (mask & 0b10) ? target[blockPos + 1] : 0;
							data[pixel + 2] = (mask & 0b100) ? target[blockPos + 2] : 0;
							data[pixel + 3] = (mask & 0b1000) ? target[blockPos + 3] : 255;
						}
						blockPos += 4;
					}
				}
				pos += blockBytes;
			}
		}

		if (!canvasData)
			return new BufferWrapper(data);
	}

	/**
	 * Match the uncompressed data with the palette.
	 * @param {ImageData} canvasData
	 * @param {number} mask
	 * @returns {BufferWrapper|undefined}
	 * @private
	 */
	_getUncompressed(canvasData, mask) {
		if (canvasData) {
			for (let i = 0, n = this.scaledLength; i < n; i++) {
				const ofs = i * 4;
				const colour = this.palette[this.rawData[i]];

				canvasData[ofs] = (mask & 0b1) ? colour[2] : 0;
				canvasData[ofs + 1] = (mask & 0b10) ? colour[1] : 0;
				canvasData[ofs + 2] = (mask & 0b100) ? colour[0] : 0;
				canvasData[ofs + 3] = (mask & 0b1000) ? this._getAlpha(i) : 255;
			}
		} else {
			const buf = BufferWrapper.alloc(this.scaledLength * 4);
			for (let i = 0, n = this.scaledLength; i < n; i++) {
				const colour = this.palette[this.rawData[i]];
				buf.writeUInt8([
					(mask & 0b1) ? colour[2] : 0,
					(mask & 0b10) ? colour[1] : 0,
					(mask & 0b100) ? colour[0] : 0,
					(mask & 0b1000) ? this._getAlpha(i) : 255
				]);
			}
			buf.seek(0);
			return buf;
		}
	}

	/**
	 * Marshal a BGRA array into an RGBA ordered buffer.
	 * @param {ImageData} canvasData
	 * @param {number} mask
	 * @returns {BufferWrapper|undefined}
	 * @private
	 */
	_marshalBGRA(canvasData, mask) {
		const data = this.rawData;

		if (canvasData) {
			for (let i = 0, n = data.length / 4; i < n; i++) {
				let ofs = i * 4;
				canvasData[ofs] = (mask & 0b1) ? data[ofs + 2] : 0;
				canvasData[ofs + 1] = (mask & 0b10) ? data[ofs + 1] : 0;
				canvasData[ofs + 2] = (mask & 0b100) ? data[ofs] : 0;
				canvasData[ofs + 3] = (mask & 0b1000) ? data[ofs + 3] : 255;
			}
		} else {
			const buf = BufferWrapper.alloc(data.length);
			for (let i = 0, n = data.length / 4; i < n; i++) {
				let ofs = i * 4;
				buf.writeUInt8([
					(mask & 0b1) ? data[ofs + 2] : 0,
					(mask & 0b10) ? data[ofs + 1] : 0,
					(mask & 0b100) ? data[ofs] : 0,
					(mask & 0b1000) ? data[ofs + 3] : 255
				]);
			}
			buf.seek(0);
			return buf;
		}
	}
}

module.exports = BLPImage;