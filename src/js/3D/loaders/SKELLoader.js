/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const CHUNK_SKB1 = 0x31424B53;
const CHUNK_SKPD = 0x44504B53;

const M2Generics = require('./M2Generics');

// See: https://wowdev.wiki/M2/.skel
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
				case CHUNK_SKB1: this.parse_chunk_skb1(); break;
				case CHUNK_SKPD: this.parse_chunk_skpd(); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	parse_chunk_skpd() {
		this.data.move(8) // _0x00[8]
		this.parent_skel_file_id = this.data.readUInt32LE();
		this.data.move(4) // _0x0c[4]
	}

	parse_chunk_skb1() {
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
				translation: M2Generics.read_m2_track(data, chunk_ofs, () => data.readFloatLE(3)),
				rotation: M2Generics.read_m2_track(data, chunk_ofs, () => data.readUInt16LE(4).map(e => (e < 0? e + 32768 : e - 32767) / 32767)),
				scale: M2Generics.read_m2_track(data, chunk_ofs, () => data.readFloatLE(3)),
				pivot: data.readFloatLE(3)
			};

			// Convert bone transformations coordinate system.
			const translations = bone.translation.values;
			const rotations = bone.rotation.values;
			const scale = bone.scale.values;
			const pivot = bone.pivot;

			for (let i = 0; i < translations.length; i++) {
				for (let j = 0; j < translations[i].length; j++) {
					const dx = translations[i][j][0];
					const dy = translations[i][j][1];
					const dz = translations[i][j][2];

					translations[i][j][0] = dx;
					translations[i][j][2] = dy * -1;
					translations[i][j][1] = dz;
				}
			}

			for (let i = 0; i < rotations.length; i++) {
				for (let j = 0; j < rotations[i].length; j++) {
					const dx = rotations[i][j][0];
					const dy = rotations[i][j][1];
					const dz = rotations[i][j][2];
					const dw = rotations[i][j][3];

					rotations[i][j][0] = dx;
					rotations[i][j][2] = dy * -1;
					rotations[i][j][1] = dz;
					rotations[i][j][3] = dw;
				}
			}

			for (let i = 0; i < scale.length; i++) {
				for (let j = 0; j < scale[i].length; j++) {
					const dx = scale[i][j][0];
					const dy = scale[i][j][1];
					const dz = scale[i][j][2];

					scale[i][j][0] = dx;
					scale[i][j][2] = dy * -1;
					scale[i][j][1] = dz;
				}
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