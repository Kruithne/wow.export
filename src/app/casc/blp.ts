/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import BufferWrapper from '../buffer';
import PNGWriter from '../png-writer';

const DXT1 = 0x1;
const DXT3 = 0x2;
const DXT5 = 0x4;

const BLP_MAGIC = 0x32504c42;

/**
 * Unpack a colour value.
 * @param block - The block to unpack from.
 * @param index - The index of the block.
 * @param ofs - The offset of the block.
 * @param colour - The colour to unpack to.
 * @param colourOfs - The offset of the colour.
 * @returns The unpacked colour value.
 */
function unpackColour(block: Array<number>, index: number, ofs: number, colour: Array<number>, colourOfs: number): number {
	const value = block[index + ofs] | (block[index + 1 + ofs] << 8);

	const r = (value >> 11) & 0x1F;
	const g = (value >> 5) & 0x3F;
	const b = value & 0x1F;

	colour[colourOfs] = (r << 3) | (r >> 2);
	colour[colourOfs + 1] = (g << 2) | (g >> 4);
	colour[colourOfs + 2] = (b << 3) | (b >> 2);
	colour[colourOfs + 3] = 255;

	return value;
}

export default class BLPImage {
	data: BufferWrapper;
	encoding: number;
	alphaDepth: number;
	alphaEncoding: number;
	containsMipmaps: number;
	width: number;
	height: number;
	scale: number;
	scaledWidth: number;
	scaledHeight: number;
	scaledLength: number;
	mapOffsets: Array<number>;
	mapSizes: Array<number>;
	mapCount: number;
	rawData: Array<number>;
	palette: Buffer;

	/**
	 * Construct a new BLPImage instance.
	 * @param data - The BLP file data.
	 */
	constructor(data: BufferWrapper) {
		this.data = data;

		// Check magic value..
		if (this.data.readUInt32() !== BLP_MAGIC)
			throw new Error('Provided data is not a BLP file (invalid header magic).');

		// Check the BLP file type..
		const type = this.data.readUInt32();
		if (type !== 1)
			throw new Error('Unsupported BLP type: ' + type);

		// Read file flags..
		this.encoding = this.data.readUInt8() as number; // NIT: Get rid of `as number`.
		this.alphaDepth = this.data.readUInt8() as number;
		this.alphaEncoding = this.data.readUInt8() as number;
		this.containsMipmaps = this.data.readUInt8() as number;

		// Read file dimensions..
		this.width = this.data.readUInt32() as number;
		this.height = this.data.readUInt32() as number;

		// Read mipmap data..
		this.mapOffsets = this.data.readUInt32Array(16);
		this.mapSizes = this.data.readUInt32Array(16);

		// Calculate available mipmaps..
		this.mapCount = 0;
		for (const ofs of this.mapOffsets) {
			if (ofs !== 0)
				this.mapCount++;
		}

		// Read colour palette..
		if (this.encoding === 1)
			this.palette = this.data.readBuffer(256 * 4);
		else
			this.palette = Buffer.alloc(0);
	}

	/**
	 * Encode this image as a data URL and return it.
	 * @param mask
	 * @returns
	 */
	getDataURL(mask = 0b1111): string {
		return this.toCanvas(mask).toDataURL();
	}

	/**
	 * Return a canvas with this BLP painted onto it.
	 * @param mask
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
	 * @param mask
	 * @param mipmap
	 * @returns BLP buffer
	 */
	toPNG(mask = 0b1111, mipmap = 0): BufferWrapper {
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
	 * @param file
	 * @param mask
	 * @param mipmap - Mipmap level
	 */
	async saveToPNG(file: string, mask = 0b1111, mipmap = 0) {
		return await this.toPNG(mask, mipmap).writeToFile(file);
	}

	/**
	 * Prepare BLP for processing.
	 * @param mipmap - Mipmap level
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
		this.rawData = this.data.readUInt8Array(this.mapSizes[mipmap]);
	}

	/**
	 * Draw the contents of this BLP file onto a canvas.
	 * @param canvas
	 * @param mipmap
	 * @param mask
	 */
	drawToCanvas(canvas: HTMLCanvasElement, mipmap = 0, mask = 0b1111) {
		this._prepare(mipmap);

		const ctx = canvas.getContext('2d');
		if (!ctx)
			throw Error('Failed to initialize canvas');

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
	 * @param mipmap
	 * @param mask
	 * @returns Buffer
	 */
	toBuffer(mipmap = 0, mask = 0b1111): BufferWrapper {
		this._prepare(mipmap);

		switch (this.encoding) {
			case 1: return this._getUncompressed(null, mask);
			case 2: return this._getCompressed(null, mask);
			case 3: return this._marshalBGRA(null, mask);
		}

		throw new Error('Invalid BLP encoding');
	}

	/**
	 * Get the contents of this BLP as an RGBA UInt8 array.
	 * @param mipmap
	 * @param mask
	 */
	toUInt8Array(mipmap = 0, mask = 0b1111): Uint8Array {
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
	 * @param index - Alpha index.
	 * @private
	 */
	_getAlpha(index: number) {
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
	 * @param canvasData
	 * @param mask
	 * @private
	 */
	_getCompressed(canvasData: ImageData | Buffer | Uint8Array | Uint8ClampedArray | null, mask = 0b1111) {
		const flags = this.alphaDepth > 1 ? (this.alphaEncoding === 7 ? DXT5 : DXT3) : DXT1;
		const data = canvasData ? canvasData : Buffer.alloc(this.scaledWidth * this.scaledHeight * 4);

		let pos = 0;
		const blockBytes = (flags & DXT1) !== 0 ? 8 : 16;
		const target = new Array(4 * 16);

		for (let y = 0, sh = this.scaledHeight; y < sh; y += 4) {
			for (let x = 0, sw = this.scaledWidth; x < sw; x += 4) {
				let blockPos = 0;

				if (this.rawData.length === pos)
					continue;

				let colourIndex = pos;
				if ((flags & (DXT3 | DXT5)) !== 0)
					colourIndex += 8;

				// Decompress colour..
				const isDXT1 = (flags & DXT1) !== 0;
				const colours: Array<number> = [];
				const a = unpackColour(this.rawData, colourIndex, 0, colours, 0);
				const b = unpackColour(this.rawData, colourIndex, 2, colours, 4);

				for (let i = 0; i < 3; i++) {
					const c = colours[i];
					const d = colours[i + 4];

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

				const index: Array<number> = [];
				for (let i = 0; i < 4; i++) {
					const packed = this.rawData[colourIndex + 4 + i];
					index[i * 4] = packed & 0x3;
					index[1 + i * 4] = (packed >> 2) & 0x3;
					index[2 + i * 4] = (packed >> 4) & 0x3;
					index[3 + i * 4] = (packed >> 6) & 0x3;
				}

				for (let i = 0; i < 16; i++) {
					const ofs = index[i] * 4;
					target[4 * i] = colours[ofs];
					target[4 * i + 1] = colours[ofs + 1];
					target[4 * i + 2] = colours[ofs + 2];
					target[4 * i + 3] = colours[ofs + 3];
				}

				if ((flags & DXT3) !== 0) {
					for (let i = 0; i < 8; i++) {
						const quant = this.rawData[pos + i];

						const low = (quant & 0x0F);
						const high = (quant & 0xF0);

						target[8 * i + 3] = (low | (low << 4));
						target[8 * i + 7] = (high | (high >> 4));
					}
				} else if ((flags & DXT5) !== 0) {
					const a0 = this.rawData[pos];
					const a1 = this.rawData[pos + 1];

					const colours: Array<number> = [];
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

					const indices: Array<number> = [];
					let blockPos = 2;
					let indicesPos = 0;

					for (let i = 0; i < 2; i++) {
						let value = 0;
						for (let j = 0; j < 3; j++) {
							const byte = this.rawData[pos + blockPos++];
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
						const sX = x + pX;
						const sY = y + pY;

						if (sX < sw && sY < sh) {
							const pixel = 4 * (sw * sY + sX);
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
			return new BufferWrapper(data as Buffer);
	}

	/**
	 * Match the uncompressed data with the palette.
	 * @param canvasData
	 * @param mask
	 * @returns If canvasData is not set, returns BufferWrapper
	 * @private
	 */
	_getUncompressed(canvasData: ImageData | Buffer | Uint8Array | Uint8ClampedArray | null, mask: number): BufferWrapper | undefined {
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
			const buf = new BufferWrapper(Buffer.allocUnsafe(this.scaledLength * 4));
			for (let i = 0, n = this.scaledLength; i < n; i++) {
				const colour = this.palette[this.rawData[i]];

				buf.writeUInt32(
					(mask & 0b1 ? colour[2] : 0) << 24 |
					(mask & 0b10 ? colour[1] : 0) << 16 |
					(mask & 0b100 ? colour[0] : 0) << 8 |
					(mask & 0b1000 ? this._getAlpha(i) : 255)
				);
			}
			buf.seek(0);
			return buf;
		}
	}

	/**
	 * Marshal a BGRA array into an RGBA ordered buffer.
	 * @param canvasData
	 * @param mask
	 * @returns
	 * @private
	 */
	_marshalBGRA(canvasData: ImageData | Buffer | Uint8ClampedArray | Uint8Array | null, mask: number): BufferWrapper | undefined {
		const data = this.rawData;

		if (canvasData) {
			for (let i = 0, n = data.length / 4; i < n; i++) {
				const ofs = i * 4;
				canvasData[ofs] = (mask & 0b1) ? data[ofs + 2] : 0;
				canvasData[ofs + 1] = (mask & 0b10) ? data[ofs + 1] : 0;
				canvasData[ofs + 2] = (mask & 0b100) ? data[ofs] : 0;
				canvasData[ofs + 3] = (mask & 0b1000) ? data[ofs + 3] : 255;
			}
		} else {
			const buf = new BufferWrapper(Buffer.allocUnsafe(data.length));
			for (let i = 0, n = data.length / 4; i < n; i++) {
				const ofs = i * 4;
				// NIT: Original code below, used to feed a Array<number> to writeUInt8 which I'm not sure was supported. Made it 4x separate calls for now.
				/*
				buf.writeUInt8([
					(mask & 0b1) ? data[ofs + 2] : 0,
					(mask & 0b10) ? data[ofs + 1] : 0,
					(mask & 0b100) ? data[ofs] : 0,
					(mask & 0b1000) ? data[ofs + 3] : 255
				]);
				*/
				buf.writeUInt8((mask & 0b1) ? data[ofs + 2] : 0);
				buf.writeUInt8((mask & 0b10) ? data[ofs + 1] : 0);
				buf.writeUInt8((mask & 0b100) ? data[ofs] : 0);
				buf.writeUInt8((mask & 0b1000) ? data[ofs + 3] : 255);
			}
			buf.seek(0);
			return buf;
		}
	}
}