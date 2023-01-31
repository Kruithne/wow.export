/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import BufferWrapper from '../../buffer';
import Texture from '../Texture';
import Skin from '../Skin';
import Constants from '../../constants';

const CHUNK_SFID = 0x44494653;
const CHUNK_TXID = 0x44495854;
const CHUNK_SKID = 0x44494B53;
const CHUNK_BFID = 0x44494642;
const CHUNK_AFID = 0x44494641;

type CAaBox = { min: Array<number>, max: Array<number> };
type M2Material = { flags: number, blendingMode: number };

// M2Array and M2Track can return a wide variety of types. To avoid declaring
// them as `any`, use these union types to define any types we expect to see.
type M2ArrayValue = number | object;
type M2TrackValue = M2ArrayValue;

type M2Bone = {
	boneID: number,
	flags: number,
	parentBone: number,
	subMeshID: number,
	boneNameCRC: number,
	translation: M2Track,
	rotation: M2Track,
	scale: M2Track,
	pivot: Array<number>
}

type M2Color = {
	color: M2Track,
	alpha: M2Track
}

class M2Track {
	globalSeq: number;
	interpolation: number;
	timestamps: Array<M2ArrayValue>;
	values: Array<M2ArrayValue>;

	/**
	 * Construct a new M2Track instance.
	 * @param globalSeq
	 * @param interpolation
	 * @param timestamps
	 * @param values
	 */
	constructor(globalSeq: number, interpolation: number, timestamps: Array<M2ArrayValue>, values: Array<M2ArrayValue>) {
		this.globalSeq = globalSeq;
		this.interpolation = interpolation;
		this.timestamps = timestamps;
		this.values = values;
	}
}

export default class M2Loader {
	data: BufferWrapper;
	isLoaded: boolean;
	md21Ofs: number;

	version: number;
	name: string;
	skins: Array<Skin>;
	lodSkins: Array<Skin>;
	viewCount: number;
	textures: Array<Texture>;
	skeletonFileID: number;
	animFileIDs: Array<number>;
	boneFileIDs: Array<number>;
	boundingBox: CAaBox;
	boundingSphereRadius: number;
	collisionBox: CAaBox;
	collisionSphereRadius: number;
	bones: Array<M2Bone>;
	collisionIndices: Array<number>;
	collisionPositions: Array<number>;
	collisionNormals: Array<number>;
	replaceableTextureLookup: Array<number>;
	vertices: Array<number>;
	normals: Array<number>;
	uv: Array<number>;
	uv2: Array<number>;
	boneWeights: Array<number>;
	boneIndices: Array<number>;
	textureTransforms: Array<number>;
	textureTransformsLookup: Array<number>;
	textureCombos: Array<number>;
	textureTypes: Array<number>;
	textureWeights: Array<number>;
	transparencyLookup: Array<number>;
	materials: Array<M2Material>;
	colors: Array<M2Color>;

	/**
	 * Construct a new M2Loader instance.
	 * @param {BufferWrapper} data
	 */
	constructor(data: BufferWrapper) {
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
			const chunkID = this.data.readUInt32();
			const chunkSize = this.data.readUInt32();
			const nextChunkPos = this.data.offset + chunkSize;

			switch (chunkID) {
				case Constants.MAGIC.MD21: await this.parseChunk_MD21(); break;
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
	 * @param index
	 */
	async getSkin(index: number) {
		const skin = this.skins[index];
		if (!skin.isLoaded)
			await skin.load();

		return skin;
	}

	/**
	 * Returns the internal array of Skin objects.
	 * Note: Unlike getSkin(), this does not load any of the skins.
	 * @returns
	 */
	getSkinList(): Array<Skin> {
		return this.skins;
	}

	/**
	 * Parse SFID chunk for skin file data IDs.
	 * @param chunkSize
	 */
	parseChunk_SFID(chunkSize: number) {
		if (this.viewCount === undefined)
			throw new Error('Cannot parse SFID chunk in M2 before MD21 chunk!');

		const lodSkinCount = (chunkSize / 4) - this.viewCount;
		this.skins = new Array(this.viewCount);
		this.lodSkins = new Array(lodSkinCount);

		for (let i = 0; i < this.viewCount; i++)
			this.skins[i] = new Skin(this.data.readUInt32());

		for (let i = 0; i < lodSkinCount; i++)
			this.lodSkins[i] = new Skin(this.data.readUInt32());
	}

	/**
	 * Parse TXID chunk for texture file data IDs.
	 */
	parseChunk_TXID() {
		if (this.textures === undefined)
			throw new Error('Cannot parse TXID chunk in M2 before MD21 chunk!');

		for (let i = 0, n = this.textures.length; i < n; i++)
			this.textures[i].fileDataID = this.data.readUInt32();
	}

	/**
	 * Parse SKID chunk for .skel file data ID.
	 */
	parseChunk_SKID() {
		this.skeletonFileID = this.data.readUInt32();
	}

	/**
	 * Parse BFID chunk for .bone file data IDs.
	 * @param {number} chunkSize
	 */
	parseChunk_BFID(chunkSize) {
		this.boneFileIDs = this.data.readUInt32Array(chunkSize / 4);
	}

	/**
	 * Parse AFID chunk for animation file data IDs.
	 * @param {number} chunkSize
	 */
	parseChunk_AFID(chunkSize: number) {
		const entryCount = chunkSize / 8;
		const entries = this.animFileIDs = new Array(entryCount);

		for (let i = 0; i < entryCount; i++) {
			entries[i] = {
				animID: this.data.readUInt16(),
				subAnimID: this.data.readUInt16(),
				fileDataID: this.data.readUInt32()
			};
		}
	}

	/**
	 * Parse MD21 chunk.
	 */
	async parseChunk_MD21() {
		const ofs = this.data.offset;

		const magic = this.data.readUInt32();
		if (magic !== Constants.MAGIC.MD20)
			throw new Error('Invalid M2 magic: ' + magic);

		this.version = this.data.readUInt32();
		this.parseChunk_MD21_modelName(ofs);
		this.data.move(4 + 8 + 8 + 8); // flags, loops, seq
		this.parseChunk_MD21_bones(ofs);
		this.data.move(8);
		this.parseChunk_MD21_vertices(ofs);
		this.viewCount = this.data.readUInt32();
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

	/**
	 * Read an M2Array.
	 * @param read - Function to read data.
	 * @returns Array of data.
	 */
	readM2Array(read: () => M2ArrayValue): Array<M2ArrayValue> {
		const data = this.data;
		const arrCount = data.readUInt32();
		const arrOfs = data.readUInt32();

		const base = data.offset;
		data.seek(this.md21Ofs + arrOfs);

		const arr = Array(arrCount);
		for (let i = 0; i < arrCount; i++)
			arr[i] = read();

		data.seek(base);
		return arr;
	}

	/** @returns An axis-aligned box with a given min/max. */
	readCAaBox(): CAaBox {
		return {
			min: this.data.readFloat32Array(3),
			max: this.data.readFloat32Array(3)
		};
	}

	/**
	 * Read an M2 track.
	 * @param read - Function to read data.
	 * @returns M2 track.
	 */
	readM2Track(read: () => M2TrackValue): M2Track {
		const data = this.data;
		const interpolation = data.readUInt16();
		const globalSeq = data.readUInt16();

		const timestamps = this.readM2Array(() => this.readM2Array(() => data.readUInt32()));
		const values = this.readM2Array(() => this.readM2Array(read));

		return new M2Track(globalSeq, interpolation, timestamps, values);
	}

	parseChunk_MD21_bones(ofs: number) {
		const data = this.data;
		const boneCount = data.readUInt32();
		const boneOfs = data.readUInt32();

		const base = data.offset;
		data.seek(boneOfs + ofs);

		this.md21Ofs = ofs;

		const bones = this.bones = Array(boneCount);
		for (let i = 0; i < boneCount; i++) {
			bones[i] = {
				boneID: data.readInt32(),
				flags: data.readUInt32(),
				parentBone: data.readInt16(),
				subMeshID: data.readUInt16(),
				boneNameCRC: data.readUInt32(),
				translation: this.readM2Track(() => data.readFloat32Array(3)),
				rotation: this.readM2Track(() => data.readUInt16Array(4).map(e => (e / 65565) - 1)),
				scale: this.readM2Track(() => data.readFloat32Array(3)),
				pivot: data.readFloat32Array(3)
			};
		}

		data.seek(base);
	}

	/**
	 * Parse collision data from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_collision(ofs: number) {
		// Parse collision boxes before the full collision chunk.
		this.boundingBox = this.readCAaBox();
		this.boundingSphereRadius = this.data.readFloat();
		this.collisionBox = this.readCAaBox();
		this.collisionSphereRadius = this.data.readFloat();

		const indicesCount = this.data.readUInt32();
		const indicesOfs = this.data.readUInt32();

		const positionsCount = this.data.readUInt32();
		const positionsOfs = this.data.readUInt32();

		const normalsCount = this.data.readUInt32();
		const normalsOfs = this.data.readUInt32();

		const base = this.data.offset;

		// indices
		this.data.seek(indicesOfs + ofs);
		this.collisionIndices = this.data.readUInt16Array(indicesCount);

		// Positions
		this.data.seek(positionsOfs + ofs);
		const positions = this.collisionPositions = new Array(positionsCount * 3);
		for (let i = 0; i < positionsCount; i++) {
			const index = i * 3;

			positions[index] = this.data.readFloat();
			positions[index + 2] = this.data.readFloat() * -1;
			positions[index + 1] = this.data.readFloat();
		}

		// Normals
		this.data.seek(normalsOfs + ofs);
		const normals = this.collisionNormals = new Array(normalsCount * 3);
		for (let i = 0; i < normalsCount; i++) {
			const index = i * 3;

			normals[index] = this.data.readFloat();
			normals[index + 2] = this.data.readFloat() * -1;
			normals[index + 1] = this.data.readFloat();
		}

		this.data.seek(base);
	}

	/**
	 * Parse replaceable texture lookups from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_replaceableTextureLookup(ofs: number) {
		const lookupCount = this.data.readUInt32();
		const lookupOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(lookupOfs + ofs);

		this.replaceableTextureLookup = this.data.readInt16Array(lookupCount);

		this.data.seek(base);
	}

	/**
	 * Parse material meta-data from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_materials(ofs: number) {
		const materialCount = this.data.readUInt32();
		const materialOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(materialOfs + ofs);

		this.materials = new Array<M2Material>(materialCount);
		for (let i = 0; i < materialCount; i++)
			this.materials[i] = { flags: this.data.readUInt16(), blendingMode: this.data.readUInt16() } as M2Material;

		this.data.seek(base);
	}

	/**
	 * Parse the model name from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_modelName(ofs: number) {
		const modelNameLength = this.data.readUInt32();
		const modelNameOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(modelNameOfs + ofs);

		// Always followed by single 0x0 character, -1 to trim).
		this.data.seek(modelNameOfs + ofs);
		this.name = this.data.readString(modelNameLength - 1);

		this.data.seek(base);
	}

	/**
	 * Parse vertices from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_vertices(ofs: number) {
		const verticesCount = this.data.readUInt32();
		const verticesOfs = this.data.readUInt32();

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
			const index = i * 3;
			vertices[index] = this.data.readFloat();
			vertices[index + 2] = this.data.readFloat() * -1;
			vertices[index + 1] = this.data.readFloat();

			for (let x = 0; x < 4; x++)
				boneWeights[index + x] = this.data.readUInt8();

			for (let x = 0; x < 4; x++)
				boneIndices[index + x] = this.data.readUInt8();

			normals[index] = this.data.readFloat();
			normals[index + 2] = this.data.readFloat() * -1;
			normals[index + 1] = this.data.readFloat();

			const uvIndex = i * 2;
			uv[uvIndex] = this.data.readFloat();
			uv[uvIndex + 1] = (this.data.readFloat() - 1) * -1;

			uv2[uvIndex] = this.data.readFloat();
			uv2[uvIndex + 1] = (this.data.readFloat() - 1) * -1;
		}

		this.data.seek(base);
	}

	/**
	 * Parse texture transformation definitions from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_textureTransforms(ofs: number) {
		const transformCount = this.data.readUInt32();
		const transformOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(transformOfs + ofs);

		const transforms = this.textureTransforms = new Array(transformCount);
		for (let i = 0; i < transformCount; i++) {
			transforms[i] = {
				translation: this.readM2Track(() => this.data.readFloat32Array(3)),
				rotation: this.readM2Track(() => this.data.readFloat32Array(4)),
				scaling: this.readM2Track(() => this.data.readFloat32Array(3))
			};
		}

		this.data.seek(base);
	}

	/**
	 * Parse texture transform lookup table from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_textureTransformLookup(ofs: number) {
		const entryCount = this.data.readUInt32();
		const entryOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(entryOfs + ofs);

		const entries = this.textureTransformsLookup = new Array(entryCount);
		for (let i = 0; i < entryCount; i++)
			entries[i] = this.data.readUInt16();

		this.data.seek(base);
	}

	/**
	 * Parse transparency lookup table from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_transparencyLookup(ofs: number) {
		const entryCount = this.data.readUInt32();
		const entryOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(entryOfs + ofs);

		const entries = this.transparencyLookup = new Array(entryCount);
		for (let i = 0; i < entryCount; i++)
			entries[i] = this.data.readUInt16();

		this.data.seek(base);
	}

	/**
	 * Parse global transparency weights from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_textureWeights(ofs: number) {
		const weightCount = this.data.readUInt32();
		const weightOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(weightOfs + ofs);

		const weights = this.textureWeights = new Array(weightCount);
		for (let i = 0; i < weightCount; i++)
			weights[i] = this.readM2Track(() => this.data.readInt16());

		this.data.seek(base);
	}

	/**
	 * Parse color/transparency data from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_colors(ofs: number) {
		const colorsCount = this.data.readUInt32();
		const colorsOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(colorsOfs + ofs);

		const colors = this.colors = new Array(colorsCount);
		for (let i = 0; i < colorsCount; i++) {
			colors[i] = {
				color: this.readM2Track(() => this.data.readFloat32Array(3)),
				alpha: this.readM2Track(() => this.data.readInt16())
			};
		}

		this.data.seek(base);
	}

	/**
	 * Parse textures from an MD21 chunk.
	 * @param ofs
	 */
	parseChunk_MD21_textures(ofs: number) {
		const texturesCount = this.data.readUInt32();
		const texturesOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(texturesOfs + ofs);

		// Read textures.
		const textures = this.textures = new Array(texturesCount);
		const textureTypes = this.textureTypes = new Array(texturesCount);

		for (let i = 0; i < texturesCount; i++) {
			const textureType = textureTypes[i] = this.data.readUInt32();
			const texture = new Texture(this.data.readUInt32());

			const nameLength = this.data.readUInt32();
			const nameOfs = this.data.readUInt32();

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
	 * @param ofs
	 */
	parseChunk_MD21_textureCombos(ofs: number) {
		const textureComboCount = this.data.readUInt32();
		const textureComboOfs = this.data.readUInt32();

		const base = this.data.offset;
		this.data.seek(textureComboOfs + ofs);
		this.textureCombos = this.data.readUInt16Array(textureComboCount);
		this.data.seek(base);
	}
}