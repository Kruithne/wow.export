const util = require('util');
const listfile = require('../../casc/listfile');
const core = require('../../core');

const MAGIC_MD21 = 0x3132444D;
const MAGIC_MD20 = 0x3032444D;

const MAGIC_SKIN = 0x4E494B53;

const CHUNK_SFID = 0x44494653;

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
					vertexStart: data.readUInt32LE(),
					vertexCount: data.readUInt16LE(),
					triangleStart: data.readUInt32LE(),
					triangleCount: data.readUInt16LE(),
					boneCount: data.readUInt16LE(),
					boneStart: data.readUInt16LE(),
					boneInfluences: data.readUInt16LE(),
					centerBoneIndex: data.readUInt16LE(),
					centerPosition: data.readFloatLE(3),
					sortCenterPosition: data.readFloatLE(3),
					sortRadius: data.readFloatLE()
				};
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
		data.move(10 * 4);
	
		const verticesCount = data.readUInt32LE();
		const verticesOfs = data.readUInt32LE();
	
		this.viewCount = data.readUInt32LE();
	
		// Read model name (Always followed by single 0x0 character, -1 to trim).
		data.seek(modelNameOfs + 8);
		this.name = data.readString(modelNameLength - 1);

		// Read verticies.	
		data.seek(this.vertices)
		const verts = this.vertices = new Array(verticesCount * 12);
		const normals = this.normals = new Array(verticesCount * 12);
		const uv = this.uv = new Array(verticesCount * 8);
		data.seek(verticesOfs + 8);
	
		for (let i = 0; i < verticesCount; i++) {
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