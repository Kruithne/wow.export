/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import State from '../../state';
import * as listfile from '../../casc/listfile';
import BufferWrapper from '../../buffer';
export default class WMOLoader {
	data: BufferWrapper;
	loaded: boolean;
	renderingOnly: boolean;
	fileDataID: number|undefined;
	fileName: string|undefined;
	groups: Array<WMOLoader>;
	groupIDs: Array<number>;

	/**
	 * Construct a new WMOLoader instance.
	 * @param data
	 * @param fileID - File name or fileDataID
	 * @param renderingOnly
	 */
	constructor(data: BufferWrapper, fileID: number | string | undefined, renderingOnly: boolean = false) {
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

	/**
	 * Load the WMO object.
	 */
	async load() {
		// Prevent duplicate loading.
		if (this.loaded)
			return;

		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32();
			const chunkSize = this.data.readUInt32();
			const nextChunkPos = this.data.offset + chunkSize;

			const handler = WMOChunkHandlers[chunkID];
			if (handler && (!this.renderingOnly || !WMOOptionalChunks.includes(chunkID)))
				handler.call(this, this.data, chunkSize);

			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}

		// Mark this instance as loaded.
		this.loaded = true;
	}

	/**
	 * Get a group from this WMO.
	 * @param index
	 */
	async getGroup(index: number) {
		if (!this.groups)
			throw new Error('Attempted to obtain group from a root WMO.');

		const casc = State.casc;

		let group = this.groups[index];
		if (group)
			return group;

		let data: BufferWrapper;
		if (this.groupIDs)
			data = await casc.getFile(this.groupIDs[index]);
		else
			data = await casc.getFileByName((this.fileName as string).replace('.wmo', '_' + index.toString().padStart(3, '0') + '.wmo'));

		group = this.groups[index] = new WMOLoader(data, undefined, this.renderingOnly);
		await group.load();

		return group;
	}

	/**
	 * Read a position, corrected from WoW's co-ordinate system.
	 */
	readPosition() {
		const x = this.data.readFloat();
		const z = this.data.readFloat();
		const y = this.data.readFloat() * -1;

		return [x, y, z];
	}
}

/**
 * Optional chunks that are not required for rendering.
 * @type {Array<number>}
 */
const WMOOptionalChunks = [
	0x4D4C4951, // MLIQ (Liquid)
	0x4D464F47, // MFOG (Fog)
	0x4D4F5056, // MOPV (Portal Vertices)
	0x4D4F5052, // MOPR (Map Object Portal References)
	0x4D4F5054, // MOPT (Portal Triangles)
	0x4D4F4356, // MOCV (Vertex Colors)
	0x4D44414C, // MDAL (Ambient Color)
];

const WMOChunkHandlers = {
	// MVER (Version) [WMO Root, WMO Group]
	0x4D564552: function(data: BufferWrapper) {
		this.version = data.readUInt32();
		if (this.version !== 17)
			throw new Error(util.format('Unsupported WMO version: %d', this.version));
	},

	// MOHD (Header) [WMO Root]
	0x4D4F4844: function(data: BufferWrapper) {
		this.materialCount = data.readUInt32();
		this.groupCount = data.readUInt32();
		this.portalCount = data.readUInt32();
		this.lightCount = data.readUInt32();
		this.modelCount = data.readUInt32();
		this.doodadCount = data.readUInt32();
		this.setCount = data.readUInt32();
		this.ambientColor = data.readUInt32();
		this.areaTableID = data.readUInt32();
		this.boundingBox1 = data.readFloat32Array(3);
		this.boundingBox2 = data.readFloat32Array(3);
		this.flags = data.readUInt16();
		this.lodCount = data.readUInt16();

		this.groups = new Array(this.groupCount);
	},


	// MOTX (Textures) [Classic, WMO Root]
	0x4D4F5458: function(data: BufferWrapper, chunkSize: number) {
		this.textureNames = data.readStringBlock(chunkSize);
	},

	// MFOG (Fog) [WMO Root]
	0x4D464F47: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 48;
		const fogs = this.fogs = new Array(count);

		for (let i = 0; i < count; i++) {
			fogs[i] = {
				flags: data.readUInt32(),
				position: data.readFloat32Array(3),
				radiusSmall: data.readFloat(),
				radiusLarge: data.readFloat(),
				fog: {
					end: data.readFloat(),
					startScalar: data.readFloat(),
					color: data.readUInt32()
				},
				underwaterFog: {
					end: data.readFloat(),
					startScalar: data.readFloat(),
					color: data.readUInt32()
				}
			};
		}
	},

	// MOMT (Materials) [WMO Root]
	0x4D4F4D54: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 64;
		const materials = this.materials = new Array(count);

		for (let i = 0; i < count; i++) {
			materials[i] = {
				flags: data.readUInt32(),
				shader: data.readUInt32(),
				blendMode: data.readUInt32(),
				texture1: data.readUInt32(),
				color1: data.readUInt32(),
				color1b: data.readUInt32(),
				texture2: data.readUInt32(),
				color2: data.readUInt32(),
				groupType: data.readUInt32(),
				texture3: data.readUInt32(),
				color3: data.readUInt32(),
				flags3: data.readUInt32(),
				runtimeData: data.readUInt32Array(4)
			};
		}
	},

	// MOPV (Portal Vertices) [WMO Root]
	0x4D4F5056: function(data: BufferWrapper, chunkSize: number) {
		const vertexCount = chunkSize / (3 * 4);
		this.portalVertices = new Array(vertexCount);
		for (let i = 0; i < vertexCount; i++)
			this.portalVertices[i] = data.readFloat32Array(3);
	},

	// MOPT (Portal Triangles) [WMO Root]
	0x4D4F5054: function(data: BufferWrapper) {
		this.portalInfo = new Array(this.portalCount);
		for (let i = 0; i < this.portalCount; i++) {
			this.portalInfo[i] = {
				startVertex: data.readUInt16(),
				count: data.readUInt16(),
				plane: data.readFloat32Array(4)
			};
		}
	},

	// MOPR (Map Object Portal References) [WMO Root]
	0x4D4F5052: function(data: BufferWrapper, chunkSize: number) {
		const entryCount = chunkSize / 8;
		this.mopr = new  Array(entryCount);

		for (let i = 0; i < entryCount; i++) {
			this.mopr[i] = {
				portalIndex: data.readUInt16(),
				groupIndex: data.readUInt16(),
				side: data.readInt16()
			};

			data.move(4); // Filler
		}
	},

	// MOGN (Group Names) [WMO Root]
	0x4D4F474E: function(data: BufferWrapper, chunkSize: number) {
		this.groupNames = data.readStringBlock(chunkSize);
	},

	// MOGI (Group Info) [WMO Root]
	0x4D4F4749: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 32;
		const groupInfo = this.groupInfo = new Array(count);

		for (let i = 0; i < count; i++) {
			groupInfo[i] = {
				flags: data.readUInt32(),
				boundingBox1: data.readFloat32Array(3),
				boundingBox2: data.readFloat32Array(3),
				nameIndex: data.readInt32()
			};
		}
	},

	// MODS (Doodad Sets) [WMO Root]
	0x4D4F4453: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 32;
		const doodadSets = this.doodadSets = new Array(count);

		for (let i = 0; i < count; i++) {
			doodadSets[i] = {
				name: data.readString(20).replace(/\0/g, ''),
				firstInstanceIndex: data.readUInt32(),
				doodadCount: data.readUInt32(),
				unused: data.readUInt32()
			};
		}
	},

	// MODI (Doodad IDs) [WMO Root]
	0x4D4F4449: function(data: BufferWrapper, chunkSize: number) {
		this.fileDataIDs = data.readUInt32Array(chunkSize / 4);
	},

	// MODN (Doodad Names) [WMO Root]
	0x4D4F444E: function(data: BufferWrapper, chunkSize: number) {
		this.doodadNames = data.readStringBlock(chunkSize);

		// Doodads are still reference as MDX in Classic doodad names, replace them with m2.
		for (const [ofs, file] of Object.entries(this.doodadNames))
			this.doodadNames[ofs] = (file as string).toLowerCase().replace('.mdx', '.m2');
	},

	// MODD (Doodad Definitions) [WMO Root]
	0x4D4F4444: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 40;
		const doodads = this.doodads = new Array(count);

		for (let i = 0; i < count; i++) {
			doodads[i] = {
				offset: data.readUInt24(),
				flags: data.readUInt8(),
				position: data.readFloat32Array(3),
				rotation: data.readFloat32Array(4),
				scale: data.readFloat(),
				color: data.readUInt8Array(4)
			};
		}
	},

	// GFID (Group file Data IDs) [WMO Root]
	0x47464944: function(data: BufferWrapper, chunkSize: number) {
		this.groupIDs = data.readUInt32Array(chunkSize / 4);
	},

	// MLIQ (Liquid Data) [WMO Group]
	0x4D4C4951: function(data: BufferWrapper) {
		// See https://wowdev.wiki/WMO#MLIQ_chunk for using this raw data.
		const liquidVertsX = data.readUInt32();
		const liquidVertsY = data.readUInt32();

		const liquidTilesX = data.readUInt32();
		const liquidTilesY = data.readUInt32();

		const liquidCorner = data.readFloat32Array(3);
		const liquidMaterialID = data.readUInt16();

		const vertCount = liquidVertsX * liquidVertsY;
		const liquidVertices = new Array(vertCount);

		for (let i = 0; i < vertCount; i++) {
			// For water (SMOWVert) the data is structured as follows:
			// uint8_t flow1;
			// uint8_t flow2;
			// uint8_t flow1Pct;
			// uint8_t filler;

			// For magma (SMOMVert) the data is structured as follows:
			// int16_t s;
			// int16_t t;

			liquidVertices[i] = {
				data: data.readUInt32(),
				height: data.readFloat()
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

	// MOCV (Vertex Colouring) [WMO Group]
	0x4D4F4356: function(data: BufferWrapper, chunkSize: number) {
		if (!this.vertexColours)
			this.vertexColours = [];

		this.vertexColours.push(data.readUInt32Array(chunkSize / 4));
	},

	// MDAL (Ambient Color) [WMO Group]
	0x4D44414C: function(data: BufferWrapper) {
		this.ambientColor = data.readUInt32();
	},

	// MOGP (Group Header) [WMO Group]
	0x4D4F4750: function(data: BufferWrapper, chunkSize: number) {
		const endOfs = data.offset + chunkSize;

		this.nameOfs = data.readUInt32();
		this.descOfs = data.readUInt32();

		this.flags = data.readUInt32();
		this.boundingBox1 = data.readFloat32Array(3);
		this.boundingBox2 = data.readFloat32Array(3);

		this.ofsPortals = data.readUInt16();
		this.numPortals = data.readUInt16();

		this.numBatchesA = data.readUInt16();
		this.numBatchesB = data.readUInt16();
		this.numBatchesC = data.readUInt32();

		data.move(4); // Unused.

		this.liquidType = data.readUInt32();
		this.groupID = data.readUInt32();

		data.move(8); // Unknown.

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32();
			const chunkSize = data.readUInt32();
			const nextChunkPos = data.offset + chunkSize;

			const handler = WMOChunkHandlers[chunkID];
			if (handler)
				handler.call(this, data, chunkSize);

			// Ensure that we start at the next chunk exactly.
			data.seek(nextChunkPos);
		}
	},

	// MOVI (indices) [WMO Group]
	0x4D4F5649: function(data: BufferWrapper, chunkSize: number) {
		this.indices = data.readUInt16Array(chunkSize / 2);
	},

	// MOVT (vertices) [WMO Group]
	0x4D4F5654: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 4;
		const vertices = this.vertices = new Array(count);

		for (let i = 0; i < count; i += 3) {
			vertices[i] = data.readFloat();
			vertices[i + 2] = data.readFloat() * -1;
			vertices[i + 1] = data.readFloat();
		}
	},

	// MOTV (UVs) [WMO Group]
	0x4D4F5456: function(data: BufferWrapper, chunkSize: number) {
		if (!this.uvs)
			this.uvs = [];

		const count = chunkSize / 4;
		const uvs = new Array(count);
		for (let i = 0; i < count; i += 2) {
			uvs[i] = data.readFloat();
			uvs[i + 1] = (data.readFloat() - 1) * -1;
		}

		this.uvs.push(uvs);
	},

	// MONR (Normals) [WMO Group]
	0x4D4F4E52: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 4;
		const normals = this.normals = new Array(count);

		for (let i = 0; i < count; i += 3) {
			normals[i] = data.readFloat();
			normals[i + 2] = data.readFloat() * -1;
			normals[i + 1] = data.readFloat();
		}
	},

	// MOBA (Render Batches) [WMO Group]
	0x4D4F4241: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 24;
		const batches = this.renderBatches = new Array(count);

		for (let i = 0; i < count; i++) {
			batches[i] = {
				possibleBox1: data.readUInt16Array(3),
				possibleBox2: data.readUInt16Array(3),
				firstFace: data.readUInt32(),
				numFaces: data.readUInt16(),
				firstVertex: data.readUInt16(),
				lastVertex: data.readUInt16(),
				flags: data.readUInt8(),
				materialID: data.readUInt8()
			};
		}
	},

	// MOPY (Material Info) [WMO Group]
	0x4D4F5059: function(data: BufferWrapper, chunkSize: number) {
		const count = chunkSize / 2;
		const materialInfo = this.materialInfo = new Array(count);

		for (let i = 0; i < count; i++)
			materialInfo[i] = { flags: data.readUInt8(), materialID: data.readUInt8() };
	},

};