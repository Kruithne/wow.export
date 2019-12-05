const Texture = require('../Texture');
const Skin = require('../Skin');

const MAGIC_MD21 = 0x3132444D;
const MAGIC_MD20 = 0x3032444D;

const CHUNK_SFID = 0x44494653;
const CHUNK_TXID = 0x44495854;

class M2Loader {
	/**
	 * Construct a new M2Loader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
	}

	/**
	 * Load the M2 model.
	 */
	async load() {
		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;
	
			switch (chunkID) {
				case MAGIC_MD21: await this.parseChunk_MD21(); break;
				case CHUNK_SFID: this.parseChunk_SFID(); break;
				case CHUNK_TXID: this.parseChunk_TXID(); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
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
	 * Parse SFID chunk for skin file data IDs.
	 */
	parseChunk_SFID() {
		if (this.viewCount === undefined)
			throw new Error('Cannot parse SFID chunk in M2 before MD21 chunk!');

		this.skins = new Array(this.viewCount);

		for (let i = 0; i < this.viewCount; i++)
			this.skins[i] = new Skin(this.data.readUInt32LE());
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
	 * Parse MD21 chunk.
	 */
	async parseChunk_MD21() {
		const ofs = this.data.offset;

		const magic = this.data.readUInt32LE();
		if (magic !== MAGIC_MD20)
			throw new Error('Invalid M2 magic: ' + magic);
	
		this.version = this.data.readUInt32LE();
		this.parseChunk_MD21_modelName(ofs);
		this.data.move(11 * 4); // flags, loops, seq, bones.
		this.parseChunk_MD21_verticies(ofs);
		this.viewCount = this.data.readUInt32LE();
		this.data.move(8); // coloursCount, coloursOfs
		this.parseChunk_MD21_textures(ofs);
		this.data.move(10 * 4); // UVAnim, TexReplace, renderFlags, boneLookup
		this.parseChunk_MD21_textureCombos(ofs);
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
	 * Parse verticies from an MD21 chunk.
	 * @param {number} ofs 
	 */
	parseChunk_MD21_verticies(ofs) {
		const verticesCount = this.data.readUInt32LE();
		const verticesOfs = this.data.readUInt32LE();

		const base = this.data.offset;
		this.data.seek(verticesOfs + ofs);

		// Read verticies.	
		const verts = this.vertices = new Array(verticesCount * 3);
		const normals = this.normals = new Array(verticesCount * 3);
		const uv = this.uv = new Array(verticesCount * 2);
	
		for (let i = 0; i < verticesCount; i++) {
			const index = i * 3;
			verts[index] = this.data.readFloatLE();
			verts[index + 1] = this.data.readFloatLE();
			verts[index + 2] = this.data.readFloatLE();
	
			this.data.move(8); // boneWeight/boneIndicies.
	
			normals[index] = this.data.readFloatLE();
			normals[index + 1] = this.data.readFloatLE();
			normals[index + 2] = this.data.readFloatLE();
	
			const uvIndex = i * 2;
			uv[uvIndex] = this.data.readFloatLE();
			uv[uvIndex + 1] = (this.data.readFloatLE() - 1) * -1;

			this.data.move(8); // texCoordX2, texCoordY2?
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
		for (let i = 0; i < texturesCount; i++) {
			const texture = new Texture(this.data.readUInt32LE(), this.data.readUInt32LE());

			// Check if texture has a filename (legacy).
			if (texture.type === 0) {
				const nameLength = this.data.readUInt32LE();
				const nameOfs = this.data.readUInt32LE();

				if (nameOfs >= 10) {
					const pos = this.data.offset;

					this.data.seek(nameOfs);
					const fileName = this.data.readString(nameLength);
					fileName.replace('\0', ''); // Remove NULL characters.

					if (fileName.length > 0)
						texture.setFileName(fileName);

					this.data.seek(pos);
				}
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
}

module.exports = M2Loader;