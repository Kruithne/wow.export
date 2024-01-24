/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const CHUNK_SKB1 = 0x31424B53;

class M2Track {
	/**
	 * Construct a new M2Track instance.
	 * @param {number} globalSeq 
	 * @param {number} interpolation 
	 * @param {Array} timestamps 
	 * @param {Array} values 
	 */
	constructor(globalSeq, interpolation, timestamps, values) {
		this.globalSeq = globalSeq;
		this.interpolation = interpolation;
		this.timestamps = timestamps;
		this.values = values;
	}
}

class SKELLoader {
	/**
	 * Construct a new SKELLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
		this.chunk_ofs = 0;
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
	 * Read an M2 track.
	 * @param {function} read 
	 * @returns {M2Track}
	 */
	readM2Track(read) {
		const data = this.data;
		const interpolation = data.readUInt16LE();
		const globalSeq = data.readUInt16LE();

		const timestamps = this.readM2Array(() => this.readM2Array(() => data.readUInt32LE()));
		const values = this.readM2Array(() => this.readM2Array(read));

		return new M2Track(globalSeq, interpolation, timestamps, values);
	}

	/**
	 * Read an M2Array.
	 * @param {function} read 
	 * @returns {Array}
	*/
	readM2Array(read) {
		const data = this.data;
		const arrCount = data.readUInt32LE();
		const arrOfs = data.readUInt32LE();

		const base = data.offset;
		data.seek(this.chunk_ofs + arrOfs);

		const arr = Array(arrCount);
		for (let i = 0; i < arrCount; i++)
			arr[i] = read();

		data.seek(base);
		return arr;
	}

	/**
	 * Parse SKB1 chunk for skin file data IDs.
	 */
	parseChunk_SKB1() {
		/*
			struct {
		  		M2Array<M2CompBone> bones;
				M2Array<uint16_t> key_bone_lookup;
			} skeleton_bone_header;

			uint8_t skeleton_bone_raw_data[];
		*/

		const data = this.data;
		this.chunk_ofs = data.offset;

		const bone_count = data.readUInt32LE();
		const bone_ofs = data.readUInt32LE();

		const base_ofs = data.offset;

		data.seek(this.chunk_ofs + bone_ofs);

		const bones = this.bones = Array(bone_count);
		for (let i = 0; i < bone_count; i++) {
			const b_boneID = data.readInt32LE();
			const b_flags = data.readUInt32LE();
			const b_parentBone = data.readInt16LE();
			const b_subMeshID = data.readUInt16LE();
			const b_boneNameCRC = data.readUInt32LE();
			const b_translation = this.readM2Track(() => data.readFloatLE(3));
			const b_rotation = this.readM2Track(() => data.readUInt16LE(4).map(e => (e / 65565) - 1));
			const b_scale = this.readM2Track(() => data.readFloatLE(3));
			const b_pivot = data.readFloatLE(3);

			const bone = {
				boneID: b_boneID,
				flags: b_flags,
				parentBone: b_parentBone,
				subMeshID: b_subMeshID,
				boneNameCRC: b_boneNameCRC,
				translation: b_translation,
				rotation: b_rotation,
				scale: b_scale,
				pivot: b_pivot
			};

			// Convert bone transformations coordinate system.
			const translations = bone.translation.values;
			const rotations = bone.rotation.values;
			const scale = bone.scale.values;
			const pivot = bone.pivot;

			for (let i = 0; i < translations.length; i += 3) {
				const dx = translations[i];
				const dy = translations[i + 1];
				const dz = translations[i + 2];
				translations[i] = dx;
				translations[i + 2] = dy * -1;
				translations[i + 1] = dz;
			}

			for (let i = 0; i < rotations.length; i += 4) {
				const dx = rotations[i];
				const dy = rotations[i + 1];
				const dz = rotations[i + 2];
				const dw = rotations[i + 3];

				rotations[i] = dx;
				rotations[i + 2] = dy * -1;
				rotations[i + 1] = dz;
				rotations[i + 3] = dw;
			}

			for (let i = 0; i < scale.length; i += 3) {
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