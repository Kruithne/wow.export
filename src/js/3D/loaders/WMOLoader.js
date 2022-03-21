/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../../core');
const listfile = require('../../casc/listfile');

const LoaderGenerics = require('./LoaderGenerics');

class WMOLoader {
	/**
	 * Construct a new WMOLoader instance.
	 * @param {BufferWrapper} data 
	 * @param {number|string} fileID File name or fileDataID
	 */
	constructor(data, fileID) {
		this.data = data;
		this.loaded = false;

		if (fileID !== undefined) {
			if (typeof fileID === 'string') {
				this.fileDataID = listfile.getByFilename(fileID);
				this.fileName = fileID;
			} else {
				this.fileDataID = fileID;
				this.fileName = listfile.getByID(fileID);
			}
		}
	}

	/**
	 * Load the WMO object.
	 */
	async load() {
		// Prevent duplicate loading.
		if (this.loaded)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;

			const handler = WMOChunkHandlers[chunkID];
			if (handler)
				handler.call(this, this.data, chunkSize);
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		// Mark this instance as loaded.
		this.loaded = true;

		// Drop internal reference to raw data.
		this.data = undefined;
	}

	/**
	 * Get a group from this WMO.
	 * @param {number} index 
	 */
	async getGroup(index) {
		if (!this.groups)
			throw new Error('Attempted to obtain group from a root WMO.');

		const casc = core.view.casc;

		let group = this.groups[index];
		if (group)
			return group;

		let data;
		if (this.groupIDs)
			data = await casc.getFile(this.groupIDs[index]);
		else
			data = await casc.getFileByName(this.fileName.replace('.wmo', '_' + index.toString().padStart(3, '0') + '.wmo'));

		group = this.groups[index] = new WMOLoader(data);
		await group.load();

		return group;
	}

	/**
	 * Read a position, corrected from WoW's co-ordinate system.
	 */
	readPosition() {
		const x = this.data.readFloatLE();
		const z = this.data.readFloatLE();
		const y = this.data.readFloatLE() * -1;

		return [x, y, z];
	}
}

const WMOChunkHandlers = {
	// MVER (Version) [WMO Root, WMO Group]
	0x4D564552: function(data) {
		this.version = data.readUInt32LE();
		if (this.version !== 17)
			throw new Error('Unsupported WMO version: %d', this.version);
	},

	// MOHD (Header) [WMO Root]
	0x4D4F4844: function(data) {
		this.materialCount = data.readUInt32LE();
		this.groupCount = data.readUInt32LE();
		this.portalCount = data.readUInt32LE();
		this.lightCount = data.readUInt32LE();
		this.modelCount = data.readUInt32LE();
		this.doodadCount = data.readUInt32LE();
		this.setCount = data.readUInt32LE();
		this.ambientColor = data.readUInt32LE();
		this.areaTableID = data.readUInt32LE();
		this.boundingBox1 = data.readFloatLE(3);
		this.boundingBox2 = data.readFloatLE(3);
		this.flags = data.readUInt16LE();
		this.lodCount = data.readUInt16LE();

		this.groups = new Array(this.groupCount);
	},


	// MOTX (Textures) [Classic, WMO Root]
	0x4D4F5458: function(data, chunkSize) {
		this.textureNames = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MFOG (Fog) [WMO Root]
	0x4D464F47: function(data, chunkSize) {
		const count = chunkSize / 48;
		const fogs = this.fogs = new Array(count);

		for (let i = 0; i < count; i++) {
			fogs[i] = {
				flags: data.readUInt32LE(),
				position: data.readFloatLE(3),
				radiusSmall: data.readFloatLE(),
				radiusLarge: data.readFloatLE(),
				fog: {
					end: data.readFloatLE(),
					startScalar: data.readFloatLE(),
					color: data.readUInt32LE()
				},
				underwaterFog: {
					end: data.readFloatLE(),
					startScalar: data.readFloatLE(),
					color: data.readUInt32LE()
				}
			};
		}
	},

	// MOMT (Materials) [WMO Root]
	0x4D4F4D54: function(data, chunkSize) {
		const count = chunkSize / 64;
		const materials = this.materials = new Array(count);

		for (let i = 0; i < count; i++) {
			materials[i] = {
				flags: data.readUInt32LE(),
				shader: data.readUInt32LE(),
				blendMode: data.readUInt32LE(),
				texture1: data.readUInt32LE(),
				color1: data.readUInt32LE(),
				color1b: data.readUInt32LE(),
				texture2: data.readUInt32LE(),
				color2: data.readUInt32LE(),
				groupType: data.readUInt32LE(),
				texture3: data.readUInt32LE(),
				color3: data.readUInt32LE(),
				flags3: data.readUInt32LE(),
				runtimeData: data.readUInt32LE(4)
			};
		}
	},

	// MOPV (Portal Vertices) [WMO Root]
	0x4D4F5056: function(data, chunkSize) {
		const vertexCount = chunkSize / (3 * 4);
		this.portalVertices = new Array(vertexCount);
		for (let i = 0; i < vertexCount; i++)
			this.portalVertices[i] = data.readFloatLE(3)
	},

	// MOPT (Portal Information) [WMO Root]
	0x4D4F5054: function(data, chunkSize) {
		this.portalInfo = new Array(this.portalCount);
		for (let i = 0; i < this.portalCount; i++) {
			this.portalInfo[i] = {
				startVertex: data.readUInt16LE(),
				count: data.readUInt16LE(),
				plane: data.readFloatLE(4)
			}
		}
	},

	// MOPR (Map Object Portal References) [WMO Root]
	0x4D4F5052: function(data, chunkSize) {
		const entryCount = chunkSize / 8;
		this.mopr = new  Array(entryCount);

		for (let i = 0; i < entryCount; i++) {
			this.mopr[i] = {
				portalIndex: data.readUInt16LE(),
				groupIndex: data.readUInt16LE(),
				side: data.readInt16LE()
			}

			data.move(4); // Filler
		}
	},

	// MOGN (Group Names) [WMO Root]
	0x4D4F474E: function(data, chunkSize) {
		this.groupNames = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MOGI (Group Info) [WMO Root]
	0x4D4F4749: function(data, chunkSize) {
		const count = chunkSize / 32;
		const groupInfo = this.groupInfo = new Array(count);

		for (let i = 0; i < count; i++) {
			groupInfo[i] = {
				flags: data.readUInt32LE(),
				boundingBox1: data.readFloatLE(3),
				boundingBox2: data.readFloatLE(3),
				nameIndex: data.readInt32LE()
			};
		}
	},

	// MODS (Doodad Sets) [WMO Root]
	0x4D4F4453: function(data, chunkSize) {
		const count = chunkSize / 32;
		const doodadSets = this.doodadSets = new Array(count);

		for (let i = 0; i < count; i++) {
			doodadSets[i] = {
				name: data.readString(20).replace(/\0/g, ''),
				firstInstanceIndex: data.readUInt32LE(),
				doodadCount: data.readUInt32LE(),
				unused: data.readUInt32LE()
			};
		}
	},

	// MODI (Doodad IDs) [WMO Root]
	0x4D4F4449: function(data, chunkSize) {
		this.fileDataIDs = data.readUInt32LE(chunkSize / 4);
	},

	// MODN (Doodad Names) [WMO Root]
	0x4D4F444E: function(data, chunkSize) {
		this.doodadNames = LoaderGenerics.ReadStringBlock(data, chunkSize);

		// Doodads are still reference as MDX in Classic doodad names, replace them with m2.
		for (const [ofs, file] of Object.entries(this.doodadNames))
			this.doodadNames[ofs] = file.toLowerCase().replace('.mdx', '.m2');
	},

	// MODD (Doodad Definitions) [WMO Root]
	0x4D4F4444: function(data, chunkSize) {
		const count = chunkSize / 40;
		const doodads = this.doodads = new Array(count);

		for (let i = 0; i < count; i++) {
			doodads[i] = {
				offset: data.readUInt24LE(),
				flags: data.readUInt8(),
				position: data.readFloatLE(3),
				rotation: data.readFloatLE(4),
				scale: data.readFloatLE(),
				color: data.readUInt8(4)
			};
		}
	},

	// GFID (Group file Data IDs) [WMO Root]
	0x47464944: function(data, chunkSize) {
		this.groupIDs = data.readUInt32LE(chunkSize / 4);
	},

	// MOCV (Vertex Colouring) [WMO Group]
	0x4D4F4356: function(data, chunkSize) {
		if (!this.vertexColours)
			this.vertexColours = [];

		this.vertexColours.push(data.readUInt32LE(chunkSize / 4));
	},

	// MDAL (Ambient Color) [WMO Group]
	0x4D44414C: function(data) {
		this.ambientColor = data.readUInt32LE();
	},

	// MOGP (Group Header) [WMO Group]
	0x4D4F4750: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;

		this.nameOfs = data.readUInt32LE();
		this.descOfs = data.readUInt32LE();

		this.flags = data.readUInt32LE();
		this.boundingBox1 = data.readFloatLE(3);
		this.boundingBox2 = data.readFloatLE(3);

		this.ofsPortals = data.readUInt16LE();
		this.numPortals = data.readUInt16LE();

		this.numBatchesA = data.readUInt16LE();
		this.numBatchesB = data.readUInt16LE();
		this.numBatchesC = data.readUInt32LE();

		data.move(4); // Unused.

		this.liquidType = data.readUInt32LE();
		this.groupID = data.readUInt32LE();
		
		data.move(8); // Unknown.

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32LE();
			const chunkSize = data.readUInt32LE();
			const nextChunkPos = data.offset + chunkSize;

			const handler = WMOChunkHandlers[chunkID];
			if (handler)
				handler.call(this, data, chunkSize);
	
			// Ensure that we start at the next chunk exactly.
			data.seek(nextChunkPos);
		}
	},

	// MOVI (indices) [WMO Group]
	0x4D4F5649: function(data, chunkSize) {
		this.indices = data.readUInt16LE(chunkSize / 2);
	},

	// MOVT (vertices) [WMO Group]
	0x4D4F5654: function(data, chunkSize) {
		const count = chunkSize / 4;
		const vertices = this.vertices = new Array(count);

		for (let i = 0; i < count; i += 3) {
			vertices[i] = data.readFloatLE();
			vertices[i + 2] = data.readFloatLE() * -1;
			vertices[i + 1] = data.readFloatLE();
		}
	},

	// MOTV (UVs) [WMO Group]
	0x4D4F5456: function(data, chunkSize) {
		if (!this.uvs)
			this.uvs = [];
		
		const count = chunkSize / 4;
		const uvs = new Array(count);
		for (let i = 0; i < count; i += 2) {
			uvs[i] = data.readFloatLE();
			uvs[i + 1] = (data.readFloatLE() - 1) * -1;
		}

		this.uvs.push(uvs);
	},

	// MONR (Normals) [WMO Group]
	0x4D4F4E52: function(data, chunkSize) {
		const count = chunkSize / 4;
		const normals = this.normals = new Array(count);

		for (let i = 0; i < count; i += 3) {
			normals[i] = data.readFloatLE();
			normals[i + 2] = data.readFloatLE() * -1;
			normals[i + 1] = data.readFloatLE();
		}
	},

	// MOBA (Render Batches) [WMO Group]
	0x4D4F4241: function(data, chunkSize) {
		const count = chunkSize / 24;
		const batches = this.renderBatches = new Array(count);

		for (let i = 0; i < count; i++) {
			batches[i] = {
				possibleBox1: data.readUInt16LE(3),
				possibleBox2: data.readUInt16LE(3),
				firstFace: data.readUInt32LE(),
				numFaces: data.readUInt16LE(),
				firstVertex: data.readUInt16LE(),
				lastVertex: data.readUInt16LE(),
				flags: data.readUInt8(),
				materialID: data.readUInt8()
			};
		}
	},

	// MOPY (Material Info) [WMO Group]
	0x4D4F5059: function(data, chunkSize) {
		const count = chunkSize / 2;
		const materialInfo = this.materialInfo = new Array(count);

		for (let i = 0; i < count; i++)
			materialInfo[i] = { flags: data.readUInt8(), materialID: data.readUInt8() };
	},

};

module.exports = WMOLoader;