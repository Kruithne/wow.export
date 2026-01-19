/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const CHUNK_AFM2 = 0x324D4641;
const CHUNK_AFSA = 0x41534641;
const CHUNK_AFSB = 0x42534641;

// See: https://wowdev.wiki/M2#.anim_files
class ANIMLoader {
	/**
	 * Construct a new ANIMLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	/**
	 * Load the animation file.
	 */
	async load(isChunked = true) {
		// Prevent multiple loading of the same file.
		if (this.isLoaded === true)
			return;

		if (!isChunked) {
			this.animData = this.data.readUInt8(this.data.remainingBytes);
			this.isLoaded = true;
			return;
		}

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case CHUNK_AFM2: this.parse_chunk_afm2(chunkSize); break; // AFM2 old animation data or ??? if AFSA/AFSB are present
				case CHUNK_AFSA: this.parse_chunk_afsa(chunkSize); break; // Skeleton Attachment animation data
				case CHUNK_AFSB: this.parse_chunk_afsb(chunkSize); break; // Skeleton Bone animation data
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	parse_chunk_afm2(chunkSize) {
		this.animData = this.data.readUInt8(chunkSize);
	}

	parse_chunk_afsa(chunkSize) {
		this.skeletonAttachmentData = this.data.readUInt8(chunkSize);
	}

	parse_chunk_afsb(chunkSize) {
		this.skeletonBoneData = this.data.readUInt8(chunkSize);
	}
}

module.exports = ANIMLoader;