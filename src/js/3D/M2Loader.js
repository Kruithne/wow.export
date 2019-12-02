const Texture = require('./Texture');
const Skin = require('./Skin');

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
		const data = this.data;
		const ofs = data.offset;

		const magic = data.readUInt32LE();
		if (magic !== MAGIC_MD20)
			throw new Error('Invalid M2 magic: ' + magic);
	
		this.version = data.readUInt32LE();
		const modelNameLength = data.readUInt32LE();
		const modelNameOfs = data.readUInt32LE();
	
		this.modelFlags = data.readUInt32LE();
		data.move(10 * 4);
	
		const verticesCount = data.readUInt32LE();
		const verticesOfs = data.readUInt32LE();
	
		this.viewCount = data.readUInt32LE();
		data.move(8); // coloursCount, coloursOfs

		const texturesCount = data.readUInt32LE();
		const texturesOfs = data.readUInt32LE();

		data.move(10 * 4); // UVAnim, TexReplace, renderFlags, boneLookup

		const textureComboCount = data.readUInt32LE();
		const textureComboOfs = data.readUInt32LE();
	
		// Read model name (Always followed by single 0x0 character, -1 to trim).
		data.seek(modelNameOfs + ofs);
		this.name = data.readString(modelNameLength - 1);

		// Read verticies.	
		const verts = this.vertices = new Array(verticesCount * 3);
		const normals = this.normals = new Array(verticesCount * 3);
		const uv = this.uv = new Array(verticesCount * 2);
		data.seek(verticesOfs + ofs);
	
		for (let i = 0; i < verticesCount; i++) {
			const index = i * 3;
			verts[index] = data.readFloatLE();
			verts[index + 1] = data.readFloatLE();
			verts[index + 2] = data.readFloatLE();
	
			data.move(8); // boneWeight/boneIndicies.
	
			normals[index] = data.readFloatLE();
			normals[index + 1] = data.readFloatLE();
			normals[index + 2] = data.readFloatLE();
	
			const uvIndex = i * 2;
			uv[uvIndex] = data.readFloatLE();
			uv[uvIndex + 1] = (data.readFloatLE() - 1) * -1;

			data.move(8); // texCoordX2, texCoordY2?
		}

		// Read textures.
		data.seek(texturesOfs + ofs);
		const textures = this.textures = new Array(texturesCount);

		for (let i = 0; i < texturesCount; i++) {
			const texture = new Texture(data.readUInt32LE(), data.readUInt32LE());

			// Check if texture has a filename (legacy).
			if (texture.type === 0) {
				const nameLength = data.readUInt32LE();
				const nameOfs = data.readUInt32LE();

				if (nameOfs >= 10) {
					const pos = data.offset;

					data.seek(nameOfs);
					const fileName = data.readString(nameLength);
					fileName.replace('\0', ''); // Remove NULL characters.

					if (fileName.length > 0)
						texture.setFileName(fileName);

					data.seek(pos);
				}
			}

			textures[i] = texture;
		}

		// Read texture lookups
		data.seek(textureComboOfs + ofs);
		this.textureCombos = data.readUInt16LE(textureComboCount);
	}
}

module.exports = M2Loader;