/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const constants = require('../../constants');
const log = require('../../log');

const CHUNK_M3DT = 0x54444D33; // 'M3DT'
const CHUNK_MES3 = 0x3353454D; // 'MES3'
const CHUNK_M3VR = 0x52564333; // 'M3VR'
const CHUNK_VPOS = 0x534F5056; // 'VPOS'
const CHUNK_VNML = 0x4C4D4E56; // 'VNML'
const CHUNK_VUV0 = 0x30565556; // 'VUV0'
const CHUNK_VUV1 = 0x31565556; // 'VUV1'
const CHUNK_VUV2 = 0x32565556; // 'VUV2'
const CHUNK_VUV3 = 0x33565556; // 'VUV3'
const CHUNK_VUV4 = 0x34565556; // 'VUV4'
const CHUNK_VUV5 = 0x35565556; // 'VUV5'
const CHUNK_VTAN = 0x4E415456; // 'VTAN'
const CHUNK_VSTR = 0x52545356; // 'VSTR'
const CHUNK_VINX = 0x584E4956; // 'VINX'
const CHUNK_VGEO = 0x4F454756; // 'VGEO'
const CHUNK_LODS = 0x53444F4C; // 'LODS'
const CHUNK_RBAT = 0x54414252; // 'RBAT'
const CHUNK_VWTS = 0x53545756; // 'VWTS'
const CHUNK_VIBP = 0x50424956; // 'VIBP'
const CHUNK_VCL0 = 0x304C4356; // 'VCL0'
const CHUNK_VCL1 = 0x314C4356; // 'VCL1'
const CHUNK_M3CL = 0x4C43334D; // 'M3CL'
const CHUNK_CPOS = 0x534F5043; // 'CPOS'
const CHUNK_CNML = 0x4C4D4E43; // 'CNML'
const CHUNK_CINX = 0x584E4943; // 'CINX'
const CHUNK_M3SI = 0x49534D33; // 'M3SI'
const CHUNK_M3ST = 0x54534D33; // 'M3ST'
const CHUNK_M3VS = 0x53564D33; // 'M3VS'
const CHUNK_M3PT = 0x54504D33; // 'M3PT'


class M3Loader {
	/**
	 * Construct a new M3Loader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	/**
	 * Convert a chunk ID to a string.
	 * @param {number} chunkID
	 */
	fourCCToString(chunkID) {
		const chunkIDArray = new Uint8Array(4);
		chunkIDArray[0] = (chunkID & 0xFF);
		chunkIDArray[1] = (chunkID >> 8) & 0xFF;
		chunkIDArray[2] = (chunkID >> 16) & 0xFF;
		chunkIDArray[3] = (chunkID >> 24) & 0xFF;
		return String.fromCharCode(...chunkIDArray);
	}

	/**
	 * Load the M3 model.
	 */
	async load() {
		// Prevent multiple loading of the same M3.
		if (this.isLoaded === true)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const propertyA = this.data.readUInt32LE();
			const propertyB = this.data.readUInt32LE();

			// chunkSize is data size after 16-byte header (id + size + propA + propB)
			const nextChunkPos = this.data.offset + chunkSize;

			log.write('M3Loader: Processing chunk %s (%d bytes)', this.fourCCToString(chunkID), chunkSize);

			switch (chunkID) {
				case CHUNK_M3DT: this.parseChunk_M3DT(chunkSize); break;
				case CHUNK_M3SI: this.parseChunk_M3SI(chunkSize); break;
				case CHUNK_MES3: this.parseChunk_MES3(chunkSize); break;
				case CHUNK_M3CL: this.parseChunk_M3CL(chunkSize); break;
			}

			// Ensure that we start at the next chunk exactly.
			if (this.data.offset !== nextChunkPos)
				log.write('M3Loader: Warning, chunk %s did not end at expected position (%d != %d)', this.fourCCToString(chunkID), this.data.offset, nextChunkPos);

			this.data.seek(nextChunkPos);
		}

		this.isLoaded = true;
	}

	/**
	 * Parse M3DT chunk.
	 * @param {number} chunkSize Size of the chunk.
	 */
	async parseChunk_M3DT(chunkSize) {
		this.data.move(chunkSize); // TODO: Skip the chunk data for now.
	}

	/**
	 * Parse MES3 chunk.
	 * @param {number} chunkSize Size of the chunk.
	 */
	parseChunk_MES3(chunkSize) {
		const endPos = this.data.offset + chunkSize;

		while (this.data.offset < endPos) {
			const subChunkID = this.data.readUInt32LE();
			const subChunkSize = this.data.readUInt32LE();

			const propertyA = this.data.readUInt32LE();
			const propertyB = this.data.readUInt32LE();

			const nextSubChunkPos = this.data.offset + subChunkSize;
			
			log.write('M3Loader: Processing MES3 sub-chunk %s (%d bytes)', this.fourCCToString(subChunkID), subChunkSize);

			switch (subChunkID) {
				case CHUNK_M3VR: break; // TODO: 0-size chunk, uses properties
				case CHUNK_VPOS: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VNML: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV0: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV1: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV2: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV3: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV4: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VUV5: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VTAN: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VINX: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VWTS: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VIBP: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VCL0: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VCL1: this.parseBufferChunk(subChunkSize, subChunkID, propertyA, propertyB); break;
				case CHUNK_VSTR: this.parseSubChunk_VSTR(subChunkSize); break;
				case CHUNK_VGEO: this.parseSubChunk_VGEO(propertyA); break;
				case CHUNK_LODS: this.parseSubChunk_LODS(propertyA, propertyB); break;
				case CHUNK_RBAT: this.parseSubChunk_RBAT(propertyA); break;
			}
	
			// Ensure that we start at the next chunk exactly.
			if (this.data.offset !== nextSubChunkPos)
				log.write('M3Loader: Warning, MES3 sub-chunk %s did not end at expected position (%d != %d)', this.fourCCToString(subChunkID), this.data.offset, nextSubChunkPos);

			this.data.seek(nextSubChunkPos);
		}
	}

	/**
	 * Parse a buffer chunk.
	 * @param {number} chunkSize Size of the chunk.
	 * @param {number} chunkID ID of the chunk.
	 * @param {number} propertyA Property A of the chunk (dynamic data per chunk type).
	 * @param {number} propertyB Property B of the chunk (dynamic data per chunk type).
	 */
	parseBufferChunk(chunkSize, chunkID, propertyA, propertyB) {
		const chunkName = this.fourCCToString(chunkID);
		const format = this.fourCCToString(propertyA);

		switch (chunkID) {
			case CHUNK_VPOS:
			{
				if (format != "3F32")
					throw new Error(`M3Loader: Unexpected ${chunkName} format ${format}`);
				const floatArray = this.ReadBufferAsFormat(format, chunkSize);
				const vertices = this.vertices = new Float32Array(floatArray.length);
				for (let i = 0; i < floatArray.length; i += 3) {
					vertices[i] = floatArray[i];
					vertices[i + 2] = floatArray[i + 1] * -1;
					vertices[i + 1] = floatArray[i + 2];
				}
				break;
			}
			case CHUNK_VNML:
			{
				if (format != "3F32")
					throw new Error(`M3Loader: Unexpected ${chunkName} format ${format}`);
				const floatArray = this.ReadBufferAsFormat(format, chunkSize);
				const normals = this.normals = new Float32Array(floatArray.length);
				for (let i = 0; i < floatArray.length; i += 3) {
					normals[i] = floatArray[i];
					normals[i + 2] = floatArray[i + 1] * -1;
					normals[i + 1] = floatArray[i + 2];
				}
				break;
			}
			case CHUNK_VUV0:
			case CHUNK_VUV1:
			case CHUNK_VUV2:
			case CHUNK_VUV3:
			case CHUNK_VUV4:
			case CHUNK_VUV5:
			{
				if (format != '2F32')
					throw new Error(`M3Loader: Unexpected ${chunkName} format ${format}`);

				const floatArray = this.ReadBufferAsFormat(format, chunkSize);
				const fixedUVs = new Float32Array(floatArray.length);
				for (let i = 0; i < floatArray.length; i += 2) {
					fixedUVs[i] = floatArray[i];
					fixedUVs[i + 1] = (floatArray[i + 1] - 1) * -1;
				}

				if (chunkID == CHUNK_VUV0)
					this.uv = fixedUVs;
				else if (chunkID == CHUNK_VUV1)
					this.uv1 = fixedUVs;
				else if (chunkID == CHUNK_VUV2)
					this.uv2 = fixedUVs;
				else if (chunkID == CHUNK_VUV3)
					this.uv3 = fixedUVs;
				else if (chunkID == CHUNK_VUV4)
					this.uv4 = fixedUVs;
				else if (chunkID == CHUNK_VUV5)
					this.uv5 = fixedUVs;

				break;
			}

			case CHUNK_VTAN:
				if (format != "4F32")
					throw new Error(`M3Loader: Unexpected ${chunkName} format ${format}`);
				this.tangents = this.ReadBufferAsFormat(format, chunkSize);
				break;
			case CHUNK_VINX:
				if (format != "1U16")
					throw new Error(`M3Loader: Unexpected ${chunkName} format ${format}`);
				this.indices = this.ReadBufferAsFormat(format, chunkSize);
				break;
			default:
				log.write('M3Loader: Unhandled buffer chunk %s with format %s (%d bytes, properties: %d, %d)', chunkName, format, chunkSize, propertyA, propertyB);
				this.data.move(chunkSize); // Skip the chunk data for now.
				return;
		}
	}

	ReadBufferAsFormat(format, chunkSize) {
		// TODO: Surely we can just read the data directly into their respective typed arrays? Unless we need to do coordinate conversion...

		if (format == "1F32" || format == "2F32" || format == "3F32" || format == "4F32") {
			const floatCount = chunkSize / 4;
			const floatArray = new Array(floatCount);
			for (let i = 0; i < floatCount; i++)
				floatArray[i] = this.data.readFloatLE();
			return floatArray;
		} else if (format == "1U16") {
			const u16Count = chunkSize / 2;
			const u16Array = new Array(u16Count);
			for (let i = 0; i < u16Count; i++)
				u16Array[i] = this.data.readUInt16LE();
			return u16Array;
		} else {
			log.write('M3Loader: Unsupported buffer format %s', format);
			throw new Error(`Unsupported format ${format}`);
		}
	}

	/**
	 * Parse VSTR sub-chunk.
	 * @param {number} chunkSize Size of the sub-chunk.
	 */
	async parseSubChunk_VSTR(chunkSize) {
		this.stringBlock = this.data.readBuffer(chunkSize, false);
	}

	/**
	 * Parse VGEO sub-chunk.
	 * @param {number} numGeosets Number of geosets.
	 */
	async parseSubChunk_VGEO(numGeosets) {
		this.geosets = new Array(numGeosets);
		for (let i = 0; i < numGeosets; i++) {
			this.geosets[i] = {
				unknown0: this.data.readUInt32LE(),
				nameCharStart: this.data.readUInt32LE(),
				nameCharCount: this.data.readUInt32LE(),	
				indexStart: this.data.readUInt32LE(),
				indexCount: this.data.readUInt32LE(),
				vertexStart: this.data.readUInt32LE(),
				vertexCount: this.data.readUInt32LE(),
				unknown1: this.data.readUInt32LE(),
				unknown2: this.data.readUInt32LE()
			};
		}
	}

	/**
	 * Parse LODS sub-chunk.
	 * @param {number} numLODs Number of LODs.
	 * @param {number} numGeosetsPerLOD Number of geosets per LOD.
	 */
	async parseSubChunk_LODS(numLODs, numGeosetsPerLOD) {
		this.lodCount = numLODs;
		this.geosetCountPerLOD = numGeosetsPerLOD;
		this.lodLevels = new Array(numLODs + 1); // +1 for the base LOD
		for (let i = 0; i < numLODs + 1; i++) {
			this.lodLevels[i] = {
				vertexCount: this.data.readUInt32LE(),
				indexCount: this.data.readUInt32LE()
			};
		}
	}

	/**
	 * Parse RBAT sub-chunk.
	 * @param {number} numBatches Number of batches.
	 */
	async parseSubChunk_RBAT(numBatches) {
		this.renderBatches = new Array(numBatches);
		for (let i = 0; i < numBatches; i++) {
			this.renderBatches[i] = {
				unknown0: this.data.readUInt16LE(),
				unknown1: this.data.readUInt16LE(),
				geosetIndex: this.data.readUInt16LE(),
				materialIndex: this.data.readUInt16LE()
			};
		}
	}

	/**
	 * Parse M3SI chunk.
	 * @param {number} chunkSize Size of the chunk.
	 */
	async parseChunk_M3SI(chunkSize) {
		this.data.move(chunkSize); // TODO: Skip the chunk data for now.
	}

	/**
	 * Parse M3CL chunk.
	 * @param {number} chunkSize Size of the chunk.
	 */
	async parseChunk_M3CL(chunkSize) {
		this.data.move(chunkSize); // TODO: Skip the chunk data for now.
	}
}

module.exports = M3Loader;