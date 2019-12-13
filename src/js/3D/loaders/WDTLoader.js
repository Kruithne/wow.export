const constants = require('../../constants');

const CHUNK_MAIN = 0x4D41494E;
const CHUNK_MAID = 0x4D414944;

const MAP_SIZE = constants.GAME.MAP_SIZE;
const MAP_SIZE_SQ = constants.GAME.MAP_SIZE_SQ;

class WDTLoader {
	/**
	 * Construct a new WDTLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
	}

	/**
	 * Load the WDT file, parsing it.
	 */
	load() {
		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case CHUNK_MAIN: this.parseChunk_MAIN(); break;
				case CHUNK_MAID: this.parseChunk_MAID(); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
	}

	/**
	 * Parse a map tile fileDataID chunk.
	 */
	parseChunk_MAID() {
		const entries = this.entries = new Array(MAP_SIZE_SQ);

		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				entries[(y * MAP_SIZE) + x] = {
					rootADT: this.data.readUInt32LE(),
					obj0ADT: this.data.readUInt32LE(),
					obj1ADT: this.data.readUInt32LE(),
					tex0ADT: this.data.readUInt32LE(),
					lodADT: this.data.readUInt32LE(),
					mapTexture: this.data.readUInt32LE(),
					mapTextureN: this.data.readUInt32LE(),
					minimapTexture: this.data.readUInt32LE()
				};
			}
		}
	}

	/**
	 * Parse a map tile table chunk.
	 */
	parseChunk_MAIN() {
		const tiles = this.tiles = new Array(MAP_SIZE_SQ);
		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				tiles[(y * MAP_SIZE) + x] = this.data.readUInt32LE();
				this.data.move(4);
			}
		}
	}
}

module.exports = WDTLoader;