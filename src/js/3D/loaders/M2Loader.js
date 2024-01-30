/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const Texture = require('../Texture');
const Skin = require('../Skin');
const constants = require('../../constants');
const M2Generics = require('./M2Generics');

const CHUNK_SFID = 0x44494653;
const CHUNK_TXID = 0x44495854;
const CHUNK_SKID = 0x44494B53;
const CHUNK_BFID = 0x44494642;
const CHUNK_AFID = 0x44494641;

class M2Loader {
	/**
	 * Construct a new M2Loader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	/**
	 * Load the M2 model.
	 */
	async load() {
		// Prevent multiple loading of the same M2.
		if (this.isLoaded === true)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case constants.MAGIC.MD21: await this.parseChunk_MD21(); break;
				case CHUNK_SFID: this.parseChunk_SFID(chunkSize); break;
				case CHUNK_TXID: this.parseChunk_TXID(); break;
				case CHUNK_SKID: this.parseChunk_SKID(); break;
				case CHUNK_BFID: this.parseChunk_BFID(chunkSize); break;
				case CHUNK_AFID: this.parseChunk_AFID(chunkSize); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	/**
	 * Get a skin at a given index from this.skins.
	 * @param {number} index 
	 */
	async getSkin(index) {
		const skin = this.skins[index];
		if (!skin.isLoaded)
			await skin.load();

		return skin;
	}

	/**
	 * Returns the internal array of Skin objects.
	 * Note: Unlike getSkin(), this does not load any of the skins.
	 * @returns {Skin[]}
	 */
	getSkinList() {
		return this.skins;
	}

	/**
	 * Parse SFID chunk for skin file data IDs.
	 * @param {number} chunkSize
	 */
	parseChunk_SFID(chunkSize) {
		if (this.viewCount === undefined)
			throw new Error('Cannot parse SFID chunk in M2 before MD21 chunk!');

		const lodSkinCount = (chunkSize / 4) - this.viewCount;
		this.skins = new Array(this.viewCount);
		this.lodSkins = new Array(lodSkinCount);

		for (let i = 0; i < this.viewCount; i++)
			this.skins[i] = new Skin(this.data.readUInt32LE());

		for (let i = 0; i < lodSkinCount; i++)
			this.lodSkins[i] = new Skin(this.data.readUInt32LE());
	}

	/**
	 * Parse TXID chunk for texture file data IDs.
	 */
	parseChunk_TXID() {
		if (this.textures === undefined)
			throw new Error('Cannot parse TXID chunk in M2 before MD21 chunk!');

		for (let i = 0, n = this.textures.length; i < n; i++)
			this.textures[i].fileDataID = this.data.readUInt32LE();
	}

	/**
	 * Parse SKID chunk for .skel file data ID.
	 */
	parseChunk_SKID() {
		this.skeletonFileID = this.data.readUInt32LE();
	}

	/**
	 * Parse BFID chunk for .bone file data IDs.
	 * @param {number} chunkSize
	 */
	parseChunk_BFID(chunkSize) {
		this.boneFileIDs = this.data.readUInt32LE(chunkSize / 4);
	}

	/**
	 * Parse AFID chunk for animation file data IDs.
	 * @param {number} chunkSize 
	 */
	parseChunk_AFID(chunkSize) {
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

	/**
	 * Parse MD21 chunk.
	 */
	async parseChunk_MD21() {
		const ofs = this.data.offset;

		const magic = this.data.readUInt32LE();
		if (magic !== constants.MAGIC.MD20)
			throw new Error('Invalid M2 magic: ' + magic);
	
		this.version = this.data.readUInt32LE();
		this.parseChunk_MD21_modelName(ofs);
		this.flags = this.data.readUInt32LE();
		this.parseChunk_MD21_globalLoops(ofs);
		this.parseChunk_MD21_animations(ofs);
		this.parseChunk_MD21_animationLookup(ofs);
		this.parseChunk_MD21_bones(ofs);
		this.data.move(8);
		this.parseChunk_MD21_vertices(ofs);
		this.viewCount = this.data.readUInt32LE();
		this.parseChunk_MD21_colors(ofs);
		this.parseChunk_MD21_textures(ofs);
		this.parseChunk_MD21_textureWeights(ofs);
		this.parseChunk_MD21_textureTransforms(ofs);
		this.parseChunk_MD21_replaceableTextureLookup(ofs);
		this.parseChunk_MD21_materials(ofs);
		this.data.move(2 * 4); // boneCombos
		this.parseChunk_MD21_textureCombos(ofs);
		this.data.move(8); // textureTransformBoneMap
		this.parseChunk_MD21_transparencyLookup(ofs);
		this.parseChunk_MD21_textureTransformLookup(ofs);
		this.parseChunk_MD21_collision(ofs);
	}

	parseChunk_MD21_bones(ofs) {
		const data = this.data;
		const boneCount = data.readUInt32LE();
		const boneOfs = data.readUInt32LE();

		const base = data.offset;
		data.seek(boneOfs + ofs);

		this.md21Ofs = ofs;

		const bones = this.bones = Array(boneCount);
		for (let i = 0; i < boneCount; i++) {
			const bone = {
				boneID: data.readInt32LE(),
				flags: data.readUInt32LE(),
				parentBone: data.readInt16LE(),
				subMeshID: data.readUInt16LE(),
				boneNameCRC: data.readUInt32LE(),
				translation: M2Generics.read_m2_track(data, ofs, () => data.readFloatLE(3)),
				rotation: M2Generics.read_m2_track(data, ofs, () => data.readUInt16LE(4).map(e => (e < 0? e + 32768 : e - 32767) / 32767)),
				scale: M2Generics.read_m2_track(data, ofs, () => data.readFloatLE(3)),
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

		data.seek(base);
	}

	/**
	 * Parse collision data from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_collision(ofs) {
		// Parse collision boxes before the full collision chunk.
		this.boundingBox = M2Generics.read_caa_bb(this.data);
		this.boundingSphereRadius = this.data.readFloatLE();
		this.collisionBox = M2Generics.read_caa_bb(this.data);
		this.collisionSphereRadius = this.data.readFloatLE();

		const indicesCount = this.data.readUInt32LE();
		const indicesOfs = this.data.readUInt32LE();

		const positionsCount = this.data.readUInt32LE();
		const positionsOfs = this.data.readUInt32LE();

		const normalsCount = this.data.readUInt32LE();
		const normalsOfs = this.data.readUInt32LE();

		const base = this.data.offset;

		// indices
		this.data.seek(indicesOfs + ofs);
		this.collisionIndices = this.data.readUInt16LE(indicesCount);

		// Positions
		this.data.seek(positionsOfs + ofs);
		const positions = this.collisionPositions = new Array(positionsCount * 3);
		for (let i = 0; i < positionsCount; i++) {
			const index = i * 3;

			positions[index] = this.data.readFloatLE();
			positions[index + 2] = this.data.readFloatLE() * -1;
			positions[index + 1] = this.data.readFloatLE();
		}

		// Normals
		this.data.seek(normalsOfs + ofs);
		const normals = this.collisionNormals = new Array(normalsCount * 3);
		for (let i = 0; i < normalsCount; i++) {
			const index = i * 3;

			normals[index] = this.data.readFloatLE();
			normals[index + 2] = this.data.readFloatLE() * -1;
			normals[index + 1] = this.data.readFloatLE();
		}

		this.data.seek(base);
	}

	/**
	 * Parse replaceable texture lookups from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_replaceableTextureLookup(ofs) {
		const lookupCount = this.data.readUInt32LE();
		const lookupOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(lookupOfs + ofs);

		this.replaceableTextureLookup = this.data.readInt16LE(lookupCount);

		this.data.seek(base);
	}
	
	/**
	 * Parse material meta-data from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_materials(ofs) {
		const materialCount = this.data.readUInt32LE();
		const materialOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(materialOfs + ofs);

		this.materials = new Array(materialCount);
		for (let i = 0; i < materialCount; i++)
			this.materials[i] = { flags: this.data.readUInt16LE(), blendingMode: this.data.readUInt16LE() };

		this.data.seek(base);
	}
	
	/**
	 * Parse the model name from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_modelName(ofs) {
		const modelNameLength = this.data.readUInt32LE();
		const modelNameOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(modelNameOfs + ofs);

		// Always followed by single 0x0 character, -1 to trim).
		this.data.seek(modelNameOfs + ofs);
		this.name = this.data.readString(modelNameLength - 1);

		this.data.seek(base);
	}

	/**
	 * Parse vertices from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_vertices(ofs) {
		const verticesCount = this.data.readUInt32LE();
		const verticesOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(verticesOfs + ofs);

		// Read vertices.
		const vertices = this.vertices = new Array(verticesCount * 3);
		const normals = this.normals = new Array(verticesCount * 3);
		const uv = this.uv = new Array(verticesCount * 2);
		const uv2 = this.uv2 = new Array(verticesCount * 2);
		const boneWeights = this.boneWeights = Array(verticesCount * 4);
		const boneIndices = this.boneIndices = Array(verticesCount * 4);
	
		for (let i = 0; i < verticesCount; i++) {
			vertices[i * 3] = this.data.readFloatLE();
			vertices[i * 3 + 2] = this.data.readFloatLE() * -1;
			vertices[i * 3 + 1] = this.data.readFloatLE();
	
			for (let x = 0; x < 4; x++)
				boneWeights[i * 4 + x] = this.data.readUInt8();

			for (let x = 0; x < 4; x++)
				boneIndices[i * 4 + x] = this.data.readUInt8();
	
			normals[i * 3] = this.data.readFloatLE();
			normals[i * 3 + 2] = this.data.readFloatLE() * -1;
			normals[i * 3 + 1] = this.data.readFloatLE();
	
			uv[i * 2] = this.data.readFloatLE();
			uv[i * 2 + 1] = (this.data.readFloatLE() - 1) * -1;

			uv2[i * 2] = this.data.readFloatLE();
			uv2[i * 2 + 1] = (this.data.readFloatLE() - 1) * -1;
		}

		this.data.seek(base);
	}

	/**
	 * Parse texture transformation definitions from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_textureTransforms(ofs) {
		const transformCount = this.data.readUInt32LE();
		const transformOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(transformOfs + ofs);

		const transforms = this.textureTransforms = new Array(transformCount);
		for (let i = 0; i < transformCount; i++) {
			transforms[i] = {
				translation: M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readFloatLE(3)),
				rotation: M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readFloatLE(4)),
				scaling: M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readFloatLE(3))
			};
		}

		this.data.seek(base);
	}

	/**
	 * Parse texture transform lookup table from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_textureTransformLookup(ofs) {
		const entryCount = this.data.readUInt32LE();
		const entryOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(entryOfs + ofs);

		const entries = this.textureTransformsLookup = new Array(entryCount);
		for (let i = 0; i < entryCount; i++)
			entries[i] = this.data.readUInt16LE();

		this.data.seek(base);
	}

	/**
	 * Parse transparency lookup table from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_transparencyLookup(ofs) {
		const entryCount = this.data.readUInt32LE();
		const entryOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(entryOfs + ofs);

		const entries = this.transparencyLookup = new Array(entryCount);
		for (let i = 0; i < entryCount; i++)
			entries[i] = this.data.readUInt16LE();

		this.data.seek(base);
	}

	/**
	 * Parse global transparency weights from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_textureWeights(ofs) {
		const weightCount = this.data.readUInt32LE();
		const weightOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(weightOfs + ofs);

		const weights = this.textureWeights = new Array(weightCount);
		for (let i = 0; i < weightCount; i++)
			weights[i] = M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readInt16LE());

		this.data.seek(base);
	}

	/**
	 * Parse color/transparency data from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_colors(ofs) {
		const colorsCount = this.data.readUInt32LE();
		const colorsOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(colorsOfs + ofs);

		const colors = this.colors = new Array(colorsCount);
		for (let i = 0; i < colorsCount; i++) {
			colors[i] = {
				color: M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readFloatLE(3)),
				alpha: M2Generics.read_m2_track(this.data, this.md21Ofs, () => this.data.readInt16LE())
			}
		}

		this.data.seek(base);
	}

	/**
	 * Parse textures from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_textures(ofs) {
		const texturesCount = this.data.readUInt32LE();
		const texturesOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(texturesOfs + ofs);

		// Read textures.
		const textures = this.textures = new Array(texturesCount);
		const textureTypes = this.textureTypes = new Array(texturesCount);

		for (let i = 0; i < texturesCount; i++) {
			const textureType = textureTypes[i] = this.data.readUInt32LE();
			const texture = new Texture(this.data.readUInt32LE());

			const nameLength = this.data.readUInt32LE();
			const nameOfs = this.data.readUInt32LE();

			// Check if texture has a filename (legacy).
			if (textureType === 0 && nameOfs > 0) {
				const pos = this.data.offset;

				this.data.seek(nameOfs);
				const fileName = this.data.readString(nameLength);
				fileName.replace('\0', ''); // Remove NULL characters.

				if (fileName.length > 0)
					texture.setFileName(fileName);

				this.data.seek(pos);
			}

			textures[i] = texture;
		}

		this.data.seek(base);
	}

	/**
	 * Parse texture combos from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_textureCombos(ofs) {
		const textureComboCount = this.data.readUInt32LE();
		const textureComboOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(textureComboOfs + ofs);
		this.textureCombos = this.data.readUInt16LE(textureComboCount);
		this.data.seek(base);
	}

	/**
	 * Parse animations.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_animations(ofs) {
		const animationCount = this.data.readUInt32LE();
		const animationOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(animationOfs + ofs);

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

		this.data.seek(base);
	}

	/**
	 * Parse animation lookup.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_animationLookup(ofs) {
		const animationLookupCount = this.data.readUInt32LE();
		const animationLookupOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(animationLookupOfs + ofs);

		this.animationLookup = this.data.readInt16LE(animationLookupCount);

		this.data.seek(base);
	}

	/**
	 * Parse global loops.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_globalLoops(ofs) {
		const globalLoopCount = this.data.readUInt32LE();
		const globalLoopOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(globalLoopOfs + ofs);

		this.globalLoops = this.data.readInt16LE(globalLoopCount);

		this.data.seek(base);
	}
}

module.exports = M2Loader;