const util = require('util');
const listfile = require('../../casc/listfile');
const core = require('../../core');
const Texture = require('../Texture');

const MAGIC_MD21 = 0x3132444D;
const MAGIC_MD20 = 0x3032444D;

const MAGIC_SKIN = 0x4E494B53;

const CHUNK_SFID = 0x44494653;
const CHUNK_TXID = 0x44495854;

class Skin {
	constructor(fileDataID) {
		this.fileDataID = fileDataID;
		this.fileName = listfile.getByID(fileDataID);
		this.isLoaded = false;
	}

	async load() {
		try {
			const data = await core.view.casc.getFile(this.fileDataID);

			const magic = data.readUInt32LE();
			if (magic !== MAGIC_SKIN)
				throw new Error('Invalid magic: ' + magic);

			const indiciesCount = data.readUInt32LE();
			const indiciesOfs = data.readUInt32LE();
			const trianglesCount = data.readUInt32LE();
			const trianglesOfs = data.readUInt32LE();
			const propertiesCount = data.readUInt32LE();
			const propertiesOfs = data.readUInt32LE();
			const submeshesCount = data.readUInt32LE();
			const submeshesOfs = data.readUInt32LE();
			const textureUnitsCount = data.readUInt32LE();
			const textureUnitsOfs = data.readUInt32LE();
			this.bones = data.readUInt32LE();
			
			// Read indicies.
			data.seek(indiciesOfs);
			this.indicies = data.readUInt16LE(indiciesCount);

			// Read triangles.
			data.seek(trianglesOfs);
			this.triangles = data.readUInt16LE(trianglesCount);

			// Read properties.
			data.seek(propertiesOfs);
			this.properties = data.readUInt8(propertiesCount);

			// Read submeshes.
			data.seek(submeshesOfs);
			this.submeshes = new Array(submeshesCount);
			for (let i = 0; i < submeshesCount; i++) {
				this.submeshes[i] = {
					submeshID: data.readUInt16LE(),
					level: data.readUInt16LE(),
					vertexStart: data.readUInt16LE(),
					vertexCount: data.readUInt16LE(),
					triangleStart: data.readUInt16LE(),
					triangleCount: data.readUInt16LE(),
					boneCount: data.readUInt16LE(),
					boneStart: data.readUInt16LE(),
					boneInfluences: data.readUInt16LE(),
					centerBoneIndex: data.readUInt16LE(),
					centerPosition: data.readFloatLE(3),
					sortCenterPosition: data.readFloatLE(3),
					sortRadius: data.readFloatLE()
				};

				this.submeshes[i].triangleStart += this.submeshes[i].level << 16;
			}

			// Read texture units.
			data.seek(textureUnitsOfs);
			this.textureUnits = new Array(textureUnitsCount);
			for (let i = 0; i < textureUnitsCount; i++) {
				this.textureUnits[i] = {
					flags: data.readUInt16LE(),
					shading: data.readUInt16LE(),
					submeshIndex: data.readUInt16LE(),
					submeshIndex2: data.readUInt16LE(),
					colorIndex: data.readUInt16LE(),
					renderFlags: data.readUInt16LE(),
					texUnitNumber: data.readUInt16LE(),
					mode: data.readUInt16LE(),
					texture: data.readUInt16LE(),
					texUnitNumber2: data.readUInt16LE(),
					transparency: data.readUInt16LE(),
					textureAnim: data.readUInt16LE()
				};
			}

			this.isLoaded = true;
		} catch (e) {
			throw new Error(util.format('Unable to load skin fileDataID %d: %s', this.fileDataID, e.message));
		}
	}
}

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
	}
}

module.exports = M2Loader;