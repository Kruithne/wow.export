/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import core from '../../core.js';
import LoaderGenerics from './LoaderGenerics.js';
import BufferWrapper from '../../buffer.js';

// wmo version constants
const WMO_VER_ALPHA = 14;      // 0.5.5 alpha
const WMO_VER_PRE_VANILLA = 16; // 0.6.0 - pre-vanilla
const WMO_VER_VANILLA = 17;    // vanilla onwards

class WMOLegacyLoader {
	constructor(data, fileID, renderingOnly = false) {
		this.data = data;
		this.loaded = false;
		this.renderingOnly = renderingOnly;

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

	async load() {
		if (this.loaded)
			return;

		const data = this.data;

		// check for MOMO wrapper (alpha v14 format)
		const first_chunk = data.readUInt32LE();
		data.seek(0);

		if (first_chunk === 0x4F4D4F4D) { // 'MOMO'
			await this._load_alpha_format();
		} else {
			await this._load_standard_format();
		}

		this.loaded = true;
		this.data = undefined;
	}

	// alpha format: MOMO wrapper contains all root data
	async _load_alpha_format() {
		const data = this.data;

		while (data.remainingBytes > 0) {
			const chunkID = data.readUInt32LE();
			const chunkSize = data.readUInt32LE();
			const nextChunkPos = data.offset + chunkSize;

			if (chunkID === 0x4F4D4F4D) { // 'MOMO'
				// parse chunks inside MOMO
				const momoEnd = data.offset + chunkSize;
				while (data.offset < momoEnd) {
					const subChunkID = data.readUInt32LE();
					const subChunkSize = data.readUInt32LE();
					const subNextPos = data.offset + subChunkSize;

					const handler = WMOLegacyChunkHandlers[subChunkID];
					if (handler && (!this.renderingOnly || !WMOOptionalChunks.includes(subChunkID)))
						handler.call(this, data, subChunkSize);

					data.seek(subNextPos);
				}
			} else if (chunkID === 0x5047474D) { // 'MOGP' - group data follows root in alpha
				// alpha has group data inline after MOMO
				this._parse_alpha_group(data, chunkSize);
			}

			data.seek(nextChunkPos);
		}
	}

	// standard format: chunked root file
	async _load_standard_format() {
		const data = this.data;

		while (data.remainingBytes > 0) {
			const chunkID = data.readUInt32LE();
			const chunkSize = data.readUInt32LE();
			const nextChunkPos = data.offset + chunkSize;

			const handler = WMOLegacyChunkHandlers[chunkID];
			if (handler && (!this.renderingOnly || !WMOOptionalChunks.includes(chunkID)))
				handler.call(this, data, chunkSize);

			data.seek(nextChunkPos);
		}
	}

	_parse_alpha_group(data, chunkSize) {
		// alpha format embeds group data directly
		// for now, store raw for later parsing
		if (!this.alphaGroups)
			this.alphaGroups = [];

		this.alphaGroups.push({
			offset: data.offset,
			size: chunkSize
		});

		data.move(chunkSize);
	}

	async getGroup(index) {
		if (!this.groups)
			throw new Error('Attempted to obtain group from a root WMO.');

		const mpq = core.view.mpq;
		let group = this.groups[index];
		if (group)
			return group;

		// alpha format: groups are inline
		if (this.version === WMO_VER_ALPHA && this.alphaGroups) {
			// parse inline group
			const groupInfo = this.alphaGroups[index];
			if (!groupInfo)
				throw new Error('Group not found: ' + index);

			// would need to re-read from original data
			throw new Error('Alpha inline group parsing not yet implemented');
		}

		const groupFileName = this.fileName.replace('.wmo', '_' + index.toString().padStart(3, '0') + '.wmo');
		const fileData = await mpq.getFile(groupFileName);

		if (!fileData)
			throw new Error('Group file not found: ' + groupFileName);

		const data = new BufferWrapper(fileData);

		group = this.groups[index] = new WMOLegacyLoader(data, undefined, this.renderingOnly);
		group.version = this.version;
		await group.load();

		return group;
	}
}

const WMOOptionalChunks = [
	0x4D4C4951, // MLIQ (Liquid)
	0x4D464F47, // MFOG (Fog)
	0x4D4F5056, // MOPV (Portal Vertices)
	0x4D4F5052, // MOPR (Map Object Portal References)
	0x4D4F5054, // MOPT (Portal Triangles)
	0x4D4F4356, // MOCV (Vertex Colors)
	0x4D44414C, // MDAL (Ambient Color)
];

const WMOLegacyChunkHandlers = {
	// MVER (Version)
	0x4D564552: function(data) {
		this.version = data.readUInt32LE();
		if (this.version < WMO_VER_ALPHA || this.version > WMO_VER_VANILLA)
			throw new Error('Unsupported WMO version: ' + this.version);
	},

	// MOHD (Header)
	0x4D4F4844: function(data, chunkSize) {
		if (this.version === WMO_VER_ALPHA) {
			// alpha format has version field and different structure
			const ver = data.readUInt32LE(); // embedded version
			this.materialCount = data.readUInt32LE();
			this.groupCount = data.readUInt32LE();
			this.portalCount = data.readUInt32LE();
			this.lightCount = data.readUInt32LE();
			this.modelCount = data.readUInt32LE();
			this.doodadCount = data.readUInt32LE();
			this.setCount = data.readUInt32LE();
			this.ambientColor = data.readUInt32LE();
			this.wmoID = data.readUInt32LE();
			// alpha has padding instead of bounding box
			data.move(0x1C); // skip padding
		} else {
			// v16/v17 standard format
			this.materialCount = data.readUInt32LE();
			this.groupCount = data.readUInt32LE();
			this.portalCount = data.readUInt32LE();
			this.lightCount = data.readUInt32LE();
			this.modelCount = data.readUInt32LE();
			this.doodadCount = data.readUInt32LE();
			this.setCount = data.readUInt32LE();
			this.ambientColor = data.readUInt32LE();
			this.wmoID = data.readUInt32LE();
			this.boundingBox1 = data.readFloatLE(3);
			this.boundingBox2 = data.readFloatLE(3);
			this.flags = data.readUInt16LE();
			this.lodCount = data.readUInt16LE();
		}

		this.groups = new Array(this.groupCount);
	},

	// MOTX (Textures)
	0x4D4F5458: function(data, chunkSize) {
		this.textureNames = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MFOG (Fog)
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

	// MOMT (Materials)
	0x4D4F4D54: function(data, chunkSize) {
		let entrySize;
		if (this.version === WMO_VER_ALPHA)
			entrySize = 0x40; // alpha has version field
		else
			entrySize = 64;

		const count = chunkSize / entrySize;
		const materials = this.materials = new Array(count);

		for (let i = 0; i < count; i++) {
			if (this.version === WMO_VER_ALPHA) {
				// alpha format
				const ver = data.readUInt32LE(); // version per material
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
					runtimeData: [0, 0, 0, 0]
				};
				// skip remaining padding
				data.move(entrySize - 52);
			} else {
				// v16/v17 standard format
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
		}
	},

	// MOPV (Portal Vertices)
	0x4D4F5056: function(data, chunkSize) {
		const vertexCount = chunkSize / 12;
		this.portalVertices = new Array(vertexCount);
		for (let i = 0; i < vertexCount; i++)
			this.portalVertices[i] = data.readFloatLE(3);
	},

	// MOPT (Portal Triangles)
	0x4D4F5054: function(data) {
		this.portalInfo = new Array(this.portalCount);
		for (let i = 0; i < this.portalCount; i++) {
			this.portalInfo[i] = {
				startVertex: data.readUInt16LE(),
				count: data.readUInt16LE(),
				plane: data.readFloatLE(4)
			};
		}
	},

	// MOPR (Map Object Portal References)
	0x4D4F5052: function(data, chunkSize) {
		const entryCount = chunkSize / 8;
		this.mopr = new Array(entryCount);

		for (let i = 0; i < entryCount; i++) {
			this.mopr[i] = {
				portalIndex: data.readUInt16LE(),
				groupIndex: data.readUInt16LE(),
				side: data.readInt16LE()
			};
			data.move(2); // padding
		}
	},

	// MOGN (Group Names)
	0x4D4F474E: function(data, chunkSize) {
		this.groupNames = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MOGI (Group Info)
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

	// MODS (Doodad Sets)
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

	// MODI (Doodad IDs) - modern only, not in legacy
	0x4D4F4449: function(data, chunkSize) {
		this.fileDataIDs = data.readUInt32LE(chunkSize / 4);
	},

	// MODN (Doodad Names)
	0x4D4F444E: function(data, chunkSize) {
		this.doodadNames = LoaderGenerics.ReadStringBlock(data, chunkSize);

		// convert MDX references to M2
		for (const [ofs, file] of Object.entries(this.doodadNames))
			this.doodadNames[ofs] = file.toLowerCase().replace('.mdx', '.m2');
	},

	// MODD (Doodad Definitions)
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

	// GFID (Group file Data IDs) - modern only
	0x47464944: function(data, chunkSize) {
		this.groupIDs = data.readUInt32LE(chunkSize / 4);
	},

	// MLIQ (Liquid Data)
	0x4D4C4951: function(data) {
		const liquidVertsX = data.readUInt32LE();
		const liquidVertsY = data.readUInt32LE();
		const liquidTilesX = data.readUInt32LE();
		const liquidTilesY = data.readUInt32LE();
		const liquidCorner = data.readFloatLE(3);
		const liquidMaterialID = data.readUInt16LE();

		const vertCount = liquidVertsX * liquidVertsY;
		const liquidVertices = new Array(vertCount);

		for (let i = 0; i < vertCount; i++) {
			liquidVertices[i] = {
				data: data.readUInt32LE(),
				height: data.readFloatLE()
			};
		}

		const tileCount = liquidTilesX * liquidTilesY;
		const liquidTiles = new Array(tileCount);

		for (let i = 0; i < tileCount; i++)
			liquidTiles[i] = data.readUInt8();

		this.liquid = {
			vertX: liquidVertsX,
			vertY: liquidVertsY,
			tileX: liquidTilesX,
			tileY: liquidTilesY,
			vertices: liquidVertices,
			tiles: liquidTiles,
			corner: liquidCorner,
			materialID: liquidMaterialID
		};
	},

	// MOCV (Vertex Colouring)
	0x4D4F4356: function(data, chunkSize) {
		if (!this.vertexColours)
			this.vertexColours = [];

		this.vertexColours.push(data.readUInt8(chunkSize));
	},

	// MDAL (Ambient Color)
	0x4D44414C: function(data) {
		this.ambientColor = data.readUInt32LE();
	},

	// MOGP (Group Header)
	0x4D4F4750: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;

		this.nameOfs = data.readUInt32LE();
		this.descOfs = data.readUInt32LE();
		this.flags = data.readUInt32LE();
		this.boundingBox1 = data.readFloatLE(3);
		this.boundingBox2 = data.readFloatLE(3);

		if (this.version === WMO_VER_ALPHA) {
			// alpha uses uint32 for portal fields
			this.ofsPortals = data.readUInt32LE();
			this.numPortals = data.readUInt32LE();
		} else {
			this.ofsPortals = data.readUInt16LE();
			this.numPortals = data.readUInt16LE();
		}

		this.numBatchesA = data.readUInt16LE();
		this.numBatchesB = data.readUInt16LE();
		this.numBatchesC = data.readUInt32LE();

		data.move(4); // unused

		this.liquidType = data.readUInt32LE();
		this.groupID = data.readUInt32LE();

		data.move(8); // unknown

		// read sub-chunks
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32LE();
			const chunkSize = data.readUInt32LE();
			const nextChunkPos = data.offset + chunkSize;

			const handler = WMOLegacyChunkHandlers[chunkID];
			if (handler)
				handler.call(this, data, chunkSize);

			data.seek(nextChunkPos);
		}
	},

	// MOVI (indices)
	0x4D4F5649: function(data, chunkSize) {
		this.indices = data.readUInt16LE(chunkSize / 2);
	},

	// MOVT (vertices)
	0x4D4F5654: function(data, chunkSize) {
		const count = chunkSize / 4;
		const vertices = this.vertices = new Array(count);

		for (let i = 0; i < count; i += 3) {
			vertices[i] = data.readFloatLE();
			vertices[i + 2] = data.readFloatLE() * -1;
			vertices[i + 1] = data.readFloatLE();
		}
	},

	// MOTV (UVs)
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

	// MONR (Normals)
	0x4D4F4E52: function(data, chunkSize) {
		const count = chunkSize / 4;
		const normals = this.normals = new Array(count);

		for (let i = 0; i < count; i += 3) {
			normals[i] = data.readFloatLE();
			normals[i + 2] = data.readFloatLE() * -1;
			normals[i + 1] = data.readFloatLE();
		}
	},

	// MOBA (Render Batches)
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

	// MOPY (Material Info)
	0x4D4F5059: function(data, chunkSize) {
		const count = chunkSize / 2;
		const materialInfo = this.materialInfo = new Array(count);

		for (let i = 0; i < count; i++)
			materialInfo[i] = { flags: data.readUInt8(), materialID: data.readUInt8() };
	},

	// MOC2 (Colors 2)
	0x4D4F4332: function(data, chunkSize) {
		this.colors2 = data.readUInt8(chunkSize);
	}
};

export default WMOLegacyLoader;