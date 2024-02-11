/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const CHUNK_SKB1 = 0x31424B53;
const CHUNK_SKPD = 0x44504B53;
const CHUNK_SKS1 = 0x31534B53;
const CHUNK_AFID = 0x44494641;

const M2Generics = require('./M2Generics');
const BufferWrapper = require('../../buffer');
const AnimMapper = require('../AnimMapper');
const log = require('../../log');
const ANIMLoader = require('./ANIMLoader');
const core = require('../../core');

// See: https://wowdev.wiki/M2/.skel
class SKELLoader {
	/**
	 * Construct a new SKELLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
		this.animFiles = new Map();
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
				case CHUNK_SKS1: this.parse_chunk_sks1(); break;
				case CHUNK_AFID: this.parse_chunk_afid(chunkSize); break;
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

	parse_chunk_skb1(useAnims = false) {
		const data = this.data;
		const chunk_ofs = data.offset;
		this.boneOffset = data.offset;

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
				translation: M2Generics.read_m2_track(data, chunk_ofs, "float3", useAnims, this.animFiles),
				rotation: M2Generics.read_m2_track(data, chunk_ofs, "compquat", useAnims, this.animFiles),
				scale: M2Generics.read_m2_track(data, chunk_ofs, "float3", useAnims, this.animFiles),
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

	parse_chunk_sks1() {
		// Global loops
		const chunk_ofs = this.data.offset;

		const globalLoopCount = this.data.readUInt32LE();
		const globalLoopOfs = this.data.readUInt32LE();
		
		let prevPos = this.data.offset;
		this.data.seek(globalLoopOfs + chunk_ofs);

		this.globalLoops = this.data.readInt16LE(globalLoopCount);

		this.data.seek(prevPos);

		// Sequences
		const animationCount = this.data.readUInt32LE();
		const animationOfs = this.data.readUInt32LE();

		prevPos = this.data.offset;
		this.data.seek(animationOfs + chunk_ofs);

		const animations = this.animations = new Array(animationCount);
		for (let i = 0; i < animationCount; i++) {
			animations[i] = {
				id: this.data.readUInt16LE(),
				variationIndex: this.data.readUInt16LE(),
				duration: this.data.readUInt32LE(),
				movespeed: this.data.readFloatLE(),
				flags: this.data.readUInt32LE(),
				frequency: this.data.readInt16LE(),
				padding: this.data.readUInt16LE(),
				replayMin: this.data.readUInt32LE(),
				replayMax: this.data.readUInt32LE(),
				blendTimeIn: this.data.readUInt16LE(),
				blendTimeOut: this.data.readUInt16LE(),
				boxPosMin: this.data.readFloatLE(3),
				boxPosMax: this.data.readFloatLE(3),
				boxRadius: this.data.readFloatLE(),
				variationNext: this.data.readInt16LE(),
				aliasNext: this.data.readUInt16LE()
			};
		}

		this.data.seek(prevPos);

		// Sequence lookups
		const animationLookupCount = this.data.readUInt32LE();
		const animationLookupOfs = this.data.readUInt32LE();

		prevPos = this.data.offset;
		this.data.seek(animationLookupOfs + chunk_ofs);

		this.animationLookup = this.data.readInt16LE(animationLookupCount);

		this.data.seek(prevPos);

		// Unused spot (for now)
		this.data.move(8);
	}

	parse_chunk_afid(chunkSize) {
		const entryCount = chunkSize / 8;
		const entries = this.animFileIDs = new Array(entryCount);

		for (let i = 0; i < entryCount; i++) {
			entries[i] = {
				animID: this.data.readUInt16LE(),
				subAnimID: this.data.readUInt16LE(),
				fileDataID: this.data.readUInt32LE()
			};
		}
	}

	async loadAnims() {
		for (let i = 0; i < this.animations.length; i++) {
			let animation = this.animations[i];

			// If animation is an alias, resolve it.
			if ((animation.flags & 0x40) === 0x40) {
				while ((animation.flags & 0x40) === 0x40)
					animation = this.animations[animation.aliasNext];
			}

			if ((animation.flags & 0x20) === 0x20) {
				log.write("Skipping .anim loading for " + AnimMapper.get_anim_name(animation.id) + " because it should be in SKEL");
				continue;
			}

			for (const entry of this.animFileIDs) {
				if (entry.animID !== animation.id || entry.subAnimID !== animation.variationIndex)
					continue;

				const fileDataID = entry.fileDataID;
				if (!this.animFiles.has(i)) {
					if (fileDataID === 0) {
						log.write("Skipping .anim loading for " + AnimMapper.get_anim_name(entry.animID) + " because it has no fileDataID");
						continue;
					}
					
					log.write('Loading .anim file for animation: ' + entry.animID + ' (' + AnimMapper.get_anim_name(entry.animID) + ') - ' + entry.subAnimID);

					const loader = new ANIMLoader(await core.view.casc.getFile(fileDataID));
					await loader.load(true);

					// If the .anim file is chunked, we need to load the skeletonBoneData.
					if (loader.skeletonBoneData !== undefined)
						this.animFiles.set(i, BufferWrapper.from(loader.skeletonBoneData));
					else
						this.animFiles.set(i, BufferWrapper.from(loader.animData));
				}
			}

			if (!this.animFiles.has(i))
				log.write("Failed to load .anim file for animation: " + animation.id + ' (' + AnimMapper.get_anim_name(animation.id) + ') - ' + animation.variationIndex);
		}

		this.data.seek(this.boneOffset);

		this.parse_chunk_skb1(true);
	}
}

module.exports = SKELLoader;