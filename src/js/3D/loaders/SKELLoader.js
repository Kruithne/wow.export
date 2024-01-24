/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const CHUNK_SKB1 = 0x31424B53;

import { read_m2_track } from './M2Loader';

class SKELLoader {
	/**
	 * Construct a new SKELLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	/**
	 * Load the skeleton file.
	 */
	async load() {
		// Prevent multiple loading of the same file.
		if (this.isLoaded === true)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case CHUNK_SKB1: this.parseChunk_SKB1(chunkSize); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	/**
	 * Parse SKB1 chunk for skin file data IDs.
	 */
	parseChunk_SKB1() {
		const data = this.data;
		const chunk_ofs = data.offset;

		const bone_count = data.readUInt32LE();
		const bone_ofs = data.readUInt32LE();

		const base_ofs = data.offset;
		data.seek(chunk_ofs + bone_ofs);

		const bones = this.bones = Array(bone_count);
		for (let i = 0; i < bone_count; i++) {
			const bone = {
				boneID: data.readInt32LE(),
				flags: data.readUInt32LE(),
				parentBone: data.readInt16LE(),
				subMeshID: data.readUInt16LE(),
				boneNameCRC: data.readUInt32LE(),
				translation: read_m2_track(data, chunk_ofs, () => data.readFloatLE(3)),
				rotation: read_m2_track(data, chunk_ofs, () => data.readUInt16LE(4).map(e => (e / 65565) - 1)),
				scale: read_m2_track(data, chunk_ofs, () => data.readFloatLE(3)),
				pivot: data.readFloatLE(3)
			};

			// Convert bone transformations coordinate system.
			const translations = bone.translation.values;
			const rotations = bone.rotation.values;
			const scale = bone.scale.values;
			const pivot = bone.pivot;

			for (let i = 0, n = translations.length; i < n; i += 3) {
				const dx = translations[i];
				const dy = translations[i + 1];
				const dz = translations[i + 2];
				translations[i] = dx;
				translations[i + 2] = dy * -1;
				translations[i + 1] = dz;
			}

			for (let i = 0, n = rotations.length; i < n; i += 4) {
				const dx = rotations[i];
				const dy = rotations[i + 1];
				const dz = rotations[i + 2];
				const dw = rotations[i + 3];

				rotations[i] = dx;
				rotations[i + 2] = dy * -1;
				rotations[i + 1] = dz;
				rotations[i + 3] = dw;
			}

			for (let i = 0, n = scale.length; i < n; i += 3) {
				const dx = scale[i];
				const dy = scale[i + 1];
				const dz = scale[i + 2];
				scale[i] = dx;
				scale[i + 2] = dy * -1;
				scale[i + 1] = dz;
			}

			{
				const pivotX = pivot[0];
				const pivotY = pivot[1];
				const pivotZ = pivot[2];
				pivot[0] = pivotX;
				pivot[2] = pivotY * -1;
				pivot[1] = pivotZ;
			}

			bones[i] = bone;
		}

		data.seek(base_ofs);
	}
}

module.exports = SKELLoader;