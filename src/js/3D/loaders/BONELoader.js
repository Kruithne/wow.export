/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const CHUNK_BIDA = 0x41444942;
const CHUNK_BOMT = 0x544D4F42;

// See: https://wowdev.wiki/BONE
class BONELoader {
	/**
	 * Construct a new BONELoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	/**
	 * Load the bone file.
	 */
	async load() {
		// Prevent multiple loading of the same file.
		if (this.isLoaded === true)
			return;

		this.data.readUInt32LE(); // Version?

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;

			switch (chunkID) {
				case CHUNK_BIDA: this.parse_chunk_bida(chunkSize); break; // Bone ID
				case CHUNK_BOMT: this.parse_chunk_bomt(chunkSize); break; // Bone offset matrices
			}

			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	parse_chunk_bida(chunkSize) {
		this.boneIDs = this.data.readUInt16LE(chunkSize / 2);
	}

	parse_chunk_bomt(chunkSize) {
		const amount = (chunkSize / 16) / 4;
		this.boneOffsetMatrices = new Array(amount);
		for (let i = 0; i < amount; i++) {
			this.boneOffsetMatrices[i] = new Array(4);
			for (let j = 0; j < 4; j++)
				this.boneOffsetMatrices[i][j] = this.data.readFloatLE(4);
		}
	}
}

module.exports = BONELoader;