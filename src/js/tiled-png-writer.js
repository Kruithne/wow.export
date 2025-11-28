/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const BufferWrapper = require('./buffer');
const PNGWriter = require('./png-writer');

/**
 * Sparse PNG writer that can stitch together tiles without loading
 * the entire image into memory at once.
 */
class TiledPNGWriter {
	/**
	 * Construct a new TiledPNGWriter instance.
	 * @param {number} width - Total width of the final image
	 * @param {number} height - Total height of the final image
	 * @param {number} tileSize - Size of individual tiles (assumes square tiles)
	 */
	constructor(width, height, tileSize) {
		this.width = width;
		this.height = height;
		this.tileSize = tileSize;
		
		this.tiles = new Map();
		
		this.tileCols = Math.ceil(width / tileSize);
		this.tileRows = Math.ceil(height / tileSize);
	}

	/**
	 * Add a tile at the specified position.
	 * @param {number} tileX - Tile X coordinate (in tile units)
	 * @param {number} tileY - Tile Y coordinate (in tile units)
	 * @param {ImageData} imageData - Tile image data
	 */
	addTile(tileX, tileY, imageData) {
		const key = `${tileX},${tileY}`;
		this.tiles.set(key, {
			x: tileX,
			y: tileY,
			data: imageData,
			actualWidth: imageData.width,
			actualHeight: imageData.height
		});
	}

	/**
	 * Generate the final PNG buffer.
	 * @returns {BufferWrapper}
	 */
	getBuffer() {
		const png = new PNGWriter(this.width, this.height);
		const pixelData = png.getPixelData();
		
		pixelData.fill(0);
		
		for (const tile of this.tiles.values())
			this._writeTileToPixelData(tile, pixelData);
		
		return png.getBuffer();
	}

	/**
	 * Write a tile's data to the pixel buffer at the correct position.
	 * Uses alpha blending for proper compositing of overlapping tiles.
	 * @param {Object} tile - Tile object with position and data
	 * @param {Buffer} pixelData - Target pixel buffer
	 * @private
	 */
	_writeTileToPixelData(tile, pixelData) {
		const pixelX = tile.x * this.tileSize;
		const pixelY = tile.y * this.tileSize;

		const tileData = tile.data.data;
		const tileWidth = tile.actualWidth;
		const tileHeight = tile.actualHeight;

		for (let y = 0; y < tileHeight; y++) {
			for (let x = 0; x < tileWidth; x++) {
				const targetX = pixelX + x;
				const targetY = pixelY + y;

				if (targetX >= this.width || targetY >= this.height)
					continue;

				const sourceIndex = (y * tileWidth + x) * 4;
				const targetIndex = (targetY * this.width + targetX) * 4;

				const srcA = tileData[sourceIndex + 3] / 255;

				// fully transparent source pixel, skip
				if (srcA === 0)
					continue;

				// fully opaque source pixel, overwrite
				if (srcA === 1) {
					pixelData[targetIndex] = tileData[sourceIndex];
					pixelData[targetIndex + 1] = tileData[sourceIndex + 1];
					pixelData[targetIndex + 2] = tileData[sourceIndex + 2];
					pixelData[targetIndex + 3] = 255;
					continue;
				}

				// alpha blend (Porter-Duff "over" operation)
				const dstA = pixelData[targetIndex + 3] / 255;
				const outA = srcA + dstA * (1 - srcA);

				if (outA > 0) {
					pixelData[targetIndex] = (tileData[sourceIndex] * srcA + pixelData[targetIndex] * dstA * (1 - srcA)) / outA;
					pixelData[targetIndex + 1] = (tileData[sourceIndex + 1] * srcA + pixelData[targetIndex + 1] * dstA * (1 - srcA)) / outA;
					pixelData[targetIndex + 2] = (tileData[sourceIndex + 2] * srcA + pixelData[targetIndex + 2] * dstA * (1 - srcA)) / outA;
					pixelData[targetIndex + 3] = outA * 255;
				}
			}
		}
	}

	/**
	 * Write this PNG to a file.
	 * @param {string} file 
	 */
	async write(file) {
		return await this.getBuffer().writeToFile(file);
	}

	/**
	 * Get information about the tiles that will be included.
	 * @returns {Object} Statistics about the tiled image
	 */
	getStats() {
		return {
			totalTiles: this.tiles.size,
			imageWidth: this.width,
			imageHeight: this.height,
			tileSize: this.tileSize,
			expectedTiles: this.tileCols * this.tileRows,
			sparseRatio: this.tiles.size / (this.tileCols * this.tileRows)
		};
	}
}

module.exports = TiledPNGWriter;