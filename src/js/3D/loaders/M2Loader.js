//const BufferWrapper = require('../../buffer');

const MAGIC_MD21 = 0x3132444D;
const MAGIC_MD20 = 0x3032444D;

const CHUNK_SFID = 0x44494653;

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
			}
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
	}

	/**
	 * Parse SFID chunk for skin file data IDs.
	 */
	parseChunk_SFID() {
		if (this.viewCount === undefined)
			throw new Error('Cannot parse SFID chunk in M2 before MD21 chunk!');

		this.skinFileIDs = new Array(this.viewCount);

		for (let i = 0; i < this.viewCount; i++)
			this.skinFileIDs[i] = this.data.readUInt32LE();
	}

	/**
	 * Parse MD21 chunk.
	 */
	async parseChunk_MD21() {
		const data = this.data;
		const magic = data.readUInt32LE();
		if (magic !== MAGIC_MD20)
			throw new Error('Invalid M2 magic: ' + magic);
	
		this.version = data.readUInt32LE();
		const modelNameLength = data.readUInt32LE();
		const modelNameOfs = data.readUInt32LE();
	
		this.modelFlags = data.readUInt32LE();
		const sequenceCount = data.readUInt32LE();
		const sequenceOfs = data.readUInt32LE();
	
		const animationCount = data.readUInt32LE();
		const animationOfs = data.readUInt32LE();
		const animationLookupCount = data.readUInt32LE();
		const animationLookupOfs = data.readUInt32LE();
	
		const boneCount = data.readUInt32LE();
		const boneOfs = data.readUInt32LE();
		const keyboneLookupCount = data.readUInt32LE();
		const keyboneLookupOfs = data.readUInt32LE();
	
		const vertsCount = data.readUInt32LE();
		const vertsOfs = data.readUInt32LE();
	
		this.viewCount = data.readUInt32LE();
		const colourCount = data.readUInt32LE();
		const colourOfs = data.readUInt32LE();
	
		const textureCount = data.readUInt32LE();
		const textureOfs = data.readUInt32LE();
		const transparencyCount = data.readUInt32LE();
		const transparencyOfs = data.readUInt32LE();
	
		const uvAnimCount = data.readUInt32LE();
		const uvAnimOfs = data.readUInt32LE();
	
		const texReplaceCount = data.readUInt32LE();
		const texReplaceOfs = data.readUInt32LE();
	
		const renderFlagCount = data.readUInt32LE();
		const renderFlagOfs = data.readUInt32LE();
	
		const boneLookupTableCount = data.readUInt32LE();
		const boneLookupTableOfs = data.readUInt32LE();
	
		const textureLookupCount = data.readUInt32LE();
		const textureLookupOfs = data.readUInt32LE();
	
		const unk1Count = data.readUInt32LE();
		const unk1Ofs = data.readUInt32LE();
	
		const transLookupCount = data.readUInt32LE();
		const transLookupOfs = data.readUInt32LE();
	
		const uvAnimLookupCount = data.readUInt32LE();
		const uvAnimLookupOfs = data.readUInt32LE();
	
		// Read model name.
		data.seek(modelNameOfs);
		this.name = data.readString(modelNameLength);
	
		// Read mesh data.
		const verts = this.verticies = new Array(vertsCount * 12);
		const normals = this.normals = new Array(vertsCount * 12);
		const uv = this.uv = new Array(vertsCount * 8);
		data.seek(vertsOfs);
	
		for (let i = 0; i < vertsCount; i++) {
			const index = i * 12;
			verts[index] = data.readFloatLE();
			verts[index + 1] = data.readFloatLE();
			verts[index + 2] = data.readFloatLE();
	
			data.move(8); // boneWeight/boneIndicies.
	
			normals[index] = data.readFloatLE();
			normals[index + 1] = data.readFloatLE();
			normals[index + 2] = data.readFloatLE();
	
			const uvIndex = i * 8;
			uv[uvIndex] = data.readFloatLE();
			uv[uvIndex + 1] = data.readFloatLE();
		}
	}
}

module.exports = M2Loader;