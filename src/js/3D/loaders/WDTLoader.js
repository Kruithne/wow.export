const CHUNK_MAIN = 0x4D41494E;
const CHUNK_MAID = 0x4D414944;

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
				case CHUNK_MAIN: this.parseChunk_MAIN(chunkSize); break;
				case CHUNK_MAID: this.parseChunk_MAID(chunkSize); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
	}

	/**
	 * Parse a map tile fileDataID chunk.
	 */
	parseChunk_MAID(chunkSize) {
		const count = chunkSize / 8;
		const entries = this.entries = new Array(count);

		for (let i = 0; i < count; i++) {
			entries[i] = {
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

	/**
	 * Parse a map tile table chunk.
	 * @param {number} chunkSize
	 */
	parseChunk_MAIN(chunkSize) {
		const count = chunkSize / 8;
		const tiles = this.tiles = new Array(count);
		for (let i = 0; i < count; i++) {
			tiles[i] = this.data.readUInt32LE();
			this.data.move(4);
		}
	}
}

module.exports = WDTLoader;