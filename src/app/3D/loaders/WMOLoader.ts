/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';

import State from '../../state';
import Listfile from '../../casc/listfile';
import BufferWrapper from '../../buffer';

type WMOFog = {
	flags: number,
	position: Array<number>,
	radiusSmall: number,
	radiusLarge: number,
	fog: {
		end: number,
		startScalar: number,
		color: number
	},
	underwaterFog: {
		end: number,
		startScalar: number,
		color: number
	}
};

type WMOMaterial = {
	flags: number,
	shader: number,
	blendMode: number,
	texture1: number,
	color1: number,
	color1b: number,
	texture2: number,
	color2: number,
	groupType: number,
	texture3: number,
	color3: number,
	flags3: number,
	runtimeData: Array<number>
};

type WMOPortalInfo = {
	startVertex: number,
	count: number,
	plane: Array<number>
};

type WMOMapObjectPortalRef = {
	portalIndex: number,
	groupIndex: number,
	side: number
};

type WMOGroupInfo = {
	flags: number,
	boundingBox1: Array<number>,
	boundingBox2: Array<number>,
	nameIndex: number
};

type WMODoodadSet = {
	name: string,
	firstInstanceIndex: number,
	doodadCount: number,
	unused: number
};

type WMODoodad = {
	offset: number,
	flags: number,
	position: Array<number>,
	rotation: Array<number>,
	scale: number,
	color: Array<number>
};

type WMOLiquidVertex = {
	data: number,
	height: number
};

type WMOLiquid = {
	vertX: number,
	vertY: number,
	tileX: number,
	tileY: number,
	vertices: Array<WMOLiquidVertex>,
	tiles: Array<number>,
	corner: Array<number>,
	materialID: number
};

type WMORenderBatch = {
	possibleBox1: Array<number>,
	possibleBox2: Array<number>,
	firstFace: number,
	numFaces: number,
	firstVertex: number,
	lastVertex: number,
	flags: number,
	materialID: number,
};

type WMOMaterialInfo = {
	flags: number,
	materialID: number
};

export class WMOLoader {
	data: BufferWrapper;
	loaded: boolean;
	renderingOnly: boolean;
	fileDataID: number | undefined;
	fileName: string | undefined;
	groups: Array<WMOGroupLoader>;
	groupIDs: Array<number>;

	version: number;
	materialCount: number;
	groupCount: number;
	portalCount: number;
	lightCount: number;
	modelCount: number;
	doodadCount: number;
	setCount: number;
	ambientColor: number;
	areaTableID: number;
	boundingBox1: Array<number>;
	boundingBox2: Array<number>;
	flags: number;
	lodCount: number;
	textureNames: Map<number, string>;
	fogs: Array<WMOFog>;
	materials: Array<WMOMaterial>;
	portalVertices: Array<Array<number>>;
	portalInfo: Array<WMOPortalInfo>;
	mopr: Array<WMOMapObjectPortalRef>;
	groupNames: Map<number, string>;
	groupInfo: Array<WMOGroupInfo>;
	doodadSets: Array<WMODoodadSet>;
	fileDataIDs: Array<number>;
	doodadNames: Map<number, string>;
	doodads: Array<WMODoodad>;
	liquid: WMOLiquid;
	vertexColours: Array<Array<number>>;

	/**
	 * Construct a new WMOLoader instance.
	 * @param data
	 * @param fileID - File name or fileDataID
	 * @param renderingOnly
	 */
	constructor(data: BufferWrapper, fileID: number | string | undefined, renderingOnly = false) {
		this.data = data;
		this.loaded = false;
		this.renderingOnly = renderingOnly;

		if (fileID !== undefined) {
			if (typeof fileID === 'string') {
				this.fileDataID = Listfile.getByFilename(fileID);
				this.fileName = fileID;
			} else {
				this.fileDataID = fileID;
				this.fileName = Listfile.getByID(fileID);
			}
		}
	}

	/**
	 * Load the WMO object.
	 */
	async load(): Promise<void> {
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
	async getGroup(index: number): Promise<WMOGroupLoader> {
		if (!this.groups)
			throw new Error('Attempted to obtain group from a root WMO.');

		const casc = State.state.casc;

		let group = this.groups[index];
		if (group)
			return group;

		let data: BufferWrapper;
		if (this.groupIDs)
			data = await casc.getFile(this.groupIDs[index]);
		else
			data = await casc.getFileByName((this.fileName as string).replace('.wmo', '_' + index.toString().padStart(3, '0') + '.wmo'));

		group = this.groups[index] = new WMOGroupLoader(data, undefined, this.renderingOnly);
		await group.load();

		return group;
	}

	/**
	 * Read a position, corrected from WoW's co-ordinate system.
	 */
	readPosition(): Array<number> {
		const x = this.data.readFloat();
		const z = this.data.readFloat();
		const y = this.data.readFloat() * -1;

		return [x, y, z];
	}
}

/** Optional chunks that are not required for rendering. */
const WMOOptionalChunks: Array<number> = [
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
	0x4D564552: function(this: WMOLoader, data: BufferWrapper): void {
		this.version = data.readUInt32();
		if (this.version !== 17)
			throw new Error(util.format('Unsupported WMO version: %d', this.version));
	},

	// MOHD (Header) [WMO Root]
	0x4D4F4844: function(this: WMOLoader, data: BufferWrapper): void {
		this.materialCount = data.readUInt32();
		this.groupCount = data.readUInt32();
		this.portalCount = data.readUInt32();
		this.lightCount = data.readUInt32();
		this.modelCount = data.readUInt32();
		this.doodadCount = data.readUInt32();
		this.setCount = data.readUInt32();
		this.ambientColor = data.readUInt32();
		this.areaTableID = data.readUInt32();
		this.boundingBox1 = data.readFloatArray(3);
		this.boundingBox2 = data.readFloatArray(3);
		this.flags = data.readUInt16();
		this.lodCount = data.readUInt16();

		this.groups = new Array<WMOGroupLoader>(this.groupCount);
	},


	// MOTX (Textures) [Classic, WMO Root]
	0x4D4F5458: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		this.textureNames = data.readStringBlock(chunkSize);
	},

	// MFOG (Fog) [WMO Root]
	0x4D464F47: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 48;
		const fogs = this.fogs = new Array<WMOFog>(count);

		for (let i = 0; i < count; i++) {
			fogs[i] = {
				flags: data.readUInt32(),
				position: data.readFloatArray(3),
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
	0x4D4F4D54: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 64;
		const materials = this.materials = new Array<WMOMaterial>(count);

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
	0x4D4F5056: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const vertexCount = chunkSize / (3 * 4);
		this.portalVertices = new Array<Array<number>>(vertexCount);
		for (let i = 0; i < vertexCount; i++)
			this.portalVertices[i] = data.readFloatArray(3);
	},

	// MOPT (Portal Triangles) [WMO Root]
	0x4D4F5054: function(this: WMOLoader, data: BufferWrapper): void {
		this.portalInfo = new Array<WMOPortalInfo>(this.portalCount);
		for (let i = 0; i < this.portalCount; i++) {
			this.portalInfo[i] = {
				startVertex: data.readUInt16(),
				count: data.readUInt16(),
				plane: data.readFloatArray(4)
			};
		}
	},

	// MOPR (Map Object Portal References) [WMO Root]
	0x4D4F5052: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const entryCount = chunkSize / 8;
		this.mopr = new Array<WMOMapObjectPortalRef>(entryCount);

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
	0x4D4F474E: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		this.groupNames = data.readStringBlock(chunkSize);
	},

	// MOGI (Group Info) [WMO Root]
	0x4D4F4749: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 32;
		const groupInfo = this.groupInfo = new Array<WMOGroupInfo>(count);

		for (let i = 0; i < count; i++) {
			groupInfo[i] = {
				flags: data.readUInt32(),
				boundingBox1: data.readFloatArray(3),
				boundingBox2: data.readFloatArray(3),
				nameIndex: data.readInt32()
			};
		}
	},

	// MODS (Doodad Sets) [WMO Root]
	0x4D4F4453: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 32;
		const doodadSets = this.doodadSets = new Array<WMODoodadSet>(count);

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
	0x4D4F4449: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		this.fileDataIDs = data.readUInt32Array(chunkSize / 4);
	},

	// MODN (Doodad Names) [WMO Root]
	0x4D4F444E: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		this.doodadNames = data.readStringBlock(chunkSize);

		// Doodads are still reference as MDX in Classic doodad names, replace them with m2.
		for (const [ofs, file] of Object.entries(this.doodadNames))
			this.doodadNames[ofs] = (file as string).toLowerCase().replace('.mdx', '.m2');
	},

	// MODD (Doodad Definitions) [WMO Root]
	0x4D4F4444: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 40;
		const doodads = this.doodads = new Array<WMODoodad>(count);

		for (let i = 0; i < count; i++) {
			doodads[i] = {
				offset: data.readUInt24(),
				flags: data.readUInt8(),
				position: data.readFloatArray(3),
				rotation: data.readFloatArray(4),
				scale: data.readFloat(),
				color: data.readUInt8Array(4)
			};
		}
	},

	// GFID (Group file Data IDs) [WMO Root]
	0x47464944: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		this.groupIDs = data.readUInt32Array(chunkSize / 4);
	},

	// MLIQ (Liquid Data) [WMO Group]
	0x4D4C4951: function(this: WMOLoader, data: BufferWrapper): void {
		// See https://wowdev.wiki/WMO#MLIQ_chunk for using this raw data.
		const liquidVertsX = data.readUInt32();
		const liquidVertsY = data.readUInt32();

		const liquidTilesX = data.readUInt32();
		const liquidTilesY = data.readUInt32();

		const liquidCorner = data.readFloatArray(3);
		const liquidMaterialID = data.readUInt16();

		const vertCount = liquidVertsX * liquidVertsY;
		const liquidVertices = new Array<WMOLiquidVertex>(vertCount);

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
		const liquidTiles = new Array<number>(tileCount);

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
	0x4D4F4356: function(this: WMOLoader, data: BufferWrapper, chunkSize: number): void {
		if (!this.vertexColours)
			this.vertexColours = [];

		this.vertexColours.push(data.readUInt32Array(chunkSize / 4));
	},

	// MDAL (Ambient Color) [WMO Group]
	0x4D44414C: function(this: WMOLoader, data: BufferWrapper): void {
		this.ambientColor = data.readUInt32();
	},

	// MOGP (Group Header) [WMO Group]
	0x4D4F4750: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		const endOfs = data.offset + chunkSize;

		this.nameOfs = data.readUInt32();
		this.descOfs = data.readUInt32();

		this.flags = data.readUInt32();
		this.boundingBox1 = data.readFloatArray(3);
		this.boundingBox2 = data.readFloatArray(3);

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
	0x4D4F5649: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		this.indices = data.readUInt16Array(chunkSize / 2);
	},

	// MOVT (vertices) [WMO Group]
	0x4D4F5654: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 4;
		const vertices = this.vertices = new Array(count);

		for (let i = 0; i < count; i += 3) {
			vertices[i] = data.readFloat();
			vertices[i + 2] = data.readFloat() * -1;
			vertices[i + 1] = data.readFloat();
		}
	},

	// MOTV (UVs) [WMO Group]
	0x4D4F5456: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
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
	0x4D4F4E52: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 4;
		const normals = this.normals = new Array(count);

		for (let i = 0; i < count; i += 3) {
			normals[i] = data.readFloat();
			normals[i + 2] = data.readFloat() * -1;
			normals[i + 1] = data.readFloat();
		}
	},

	// MOBA (Render Batches) [WMO Group]
	0x4D4F4241: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 24;
		const batches = this.renderBatches = new Array<WMORenderBatch>(count);

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
	0x4D4F5059: function(this: WMOGroupLoader, data: BufferWrapper, chunkSize: number): void {
		const count = chunkSize / 2;
		const materialInfo = this.materialInfo = new Array<WMOMaterialInfo>(count);

		for (let i = 0; i < count; i++)
			materialInfo[i] = { flags: data.readUInt8(), materialID: data.readUInt8() };
	},
};

export class WMOGroupLoader extends WMOLoader {
	nameOfs: number;
	descOfs: number;
	flags: number;
	boundingBox1: Array<number>;
	boundingBox2: Array<number>;
	ofsPortals: number;
	numPortals: number;
	numBatchesA: number;
	numBatchesB: number;
	numBatchesC: number;
	liquidType: number;
	groupID: number;
	indices: Array<number>;
	vertices: Array<number>;
	uvs: Array<Array<number>>;
	normals: Array<number>;
	renderBatches: Array<WMORenderBatch>;
	materialInfo: Array<WMOMaterialInfo>;
}

export default WMOLoader;