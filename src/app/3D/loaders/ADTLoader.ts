/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
class ADTLoader {
	/**
	 * Construct a new ADTLoader instance.
	 * @param {BufferWrapper} data
	 */
	constructor(data) {
		this.data = data;
	}

	/**
	 * Parse this ADT as a root file.
	 */
	loadRoot() {
		this.chunks = new Array(16 * 16);
		this.chunkIndex = 0;

		this.handlers = ADTChunkHandlers;
		this._load();
	}

	/**
	 * Parse this ADT as an object file.
	 */
	loadObj() {
		this.handlers = ADTObjChunkHandlers;
		this._load();
	}

	/**
	 * Parse this ADT as a texture file.
	 * @param {WDTLoader} wdt
	 */
	loadTex(wdt) {
		this.texChunks = new Array(16 * 16);
		this.chunkIndex = 0;
		this.wdt = wdt;

		this.handlers = ADTTexChunkHandlers;
		this._load();
	}

	/**
	 * Load the ADT file, parsing it.
	 */
	_load() {
		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32();
			const chunkSize = this.data.readUInt32();
			const nextChunkPos = this.data.offset + chunkSize;

			const handler = this.handlers[chunkID];
			if (handler)
				handler.call(this, this.data, chunkSize);

			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
	}
}

const ADTChunkHandlers = {
	// MVER (Version)
	0x4D564552: function(data) {
		this.version = data.readUInt32();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MCNK
	0x4D434E4B: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;
		const chunk = this.chunks[this.chunkIndex++] = {
			flags: data.readUInt32(),
			indexX: data.readUInt32(),
			indexY: data.readUInt32(),
			nLayers: data.readUInt32(),
			nDoodadRefs: data.readUInt32(),
			holesHighRes: data.readUInt8(8),
			ofsMCLY: data.readUInt32(),
			ofsMCRF: data.readUInt32(),
			ofsMCAL: data.readUInt32(),
			sizeAlpha: data.readUInt32(),
			ofsMCSH: data.readUInt32(),
			sizeShadows: data.readUInt32(),
			areaID: data.readUInt32(),
			nMapObjRefs: data.readUInt32(),
			holesLowRes: data.readUInt16(),
			unk1: data.readUInt16(),
			lowQualityTextureMap: data.readInt16(8),
			noEffectDoodad: data.readInt64(),
			ofsMCSE: data.readUInt32(),
			numMCSE: data.readUInt32(),
			ofsMCLQ: data.readUInt32(),
			sizeMCLQ: data.readUInt32(),
			position: data.readFloat(3),
			ofsMCCV: data.readUInt32(),
			ofsMCLW: data.readUInt32(),
			unk2: data.readUInt32()
		};

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32();
			const subChunkSize = data.readUInt32();
			const nextChunkPos = data.offset + subChunkSize;

			const handler = RootMCNKChunkHandlers[chunkID];
			if (handler)
				handler.call(chunk, data, subChunkSize);

			// Ensure that we start at the next chunk exactly.
			data.seek(nextChunkPos);
		}
	},

	// MH2O (Liquids)
	0x4D48324F: function(data) {
		const base = data.offset;
		let dataOffsets = new Set();

		// SMLiquidChunk
		const chunks = this.liquidChunks = new Array(256);
		for (let i = 0; i < 256; i++) {
			const offsetInstances = data.readUInt32();
			const layerCount = data.readUInt32();
			const offsetAttributes = data.readUInt32();

			if (offsetAttributes > 0)
				dataOffsets.add(offsetAttributes);

			const entryOfs = data.offset;
			const chunk = chunks[i] = {
				attributes: { fishable: 0, deep: 0 },
				instances: new Array(layerCount)
			};

			if (layerCount > 0) {
				// Read chunk attributes.
				data.seek(base + offsetAttributes);
				chunk.attributes.fishable = data.readUInt64();
				chunk.attributes.deep = data.readUInt64();

				// Read SMLiquidInstance array.
				data.seek(base + offsetInstances);
				for (let j = 0; j < layerCount; j++) {
					const instance = chunk.instances[j] = {
						liquidType: data.readUInt16(),
						liquidObject: data.readUInt16(),
						minHeightLevel: data.readFloat(), // Use 0.0 if LVF = 2
						maxHeightLevel: data.readFloat(), // Use 0.0 if LVF = 2
						xOffset: data.readUInt8(), // 0 if liquidObject <= 41
						yOffset: data.readUInt8(), // 0 if liquidObject <= 41
						width: data.readUInt8(), // 8 if liquidObject <= 41
						height: data.readUInt8(), // 8 if liquidObject <= 41
						bitmap: [], // Empty == All exist.
						vertexData: {},
						offsetExistsBitmap: data.readUInt32(),
						offsetVertexData: data.readUInt32()
					};

					if (instance.offsetExistsBitmap > 0)
						dataOffsets.add(instance.offsetExistsBitmap);

					if (instance.offsetVertexData > 0)
						dataOffsets.add(instance.offsetVertexData);

					const instanceOfs = data.offset;

					// Rounding up to cover all necessary bytes for the bitmap here. Probably correct?
					if (instance.offsetExistsBitmap > 0)
						instance.bitmap = data.readUInt8(Math.ceil((instance.width * instance.height + 7) / 8));

					data.seek(instanceOfs);
				}
			}

			data.seek(entryOfs);
		}

		dataOffsets = Array.from(dataOffsets).sort((a, b) => a - b);

		// Retroactively parse vertex data by assuming the structures based on offsets.
		for (const chunk of chunks) {
			for (const instance of chunk.instances) {
				if (instance.offsetVertexData > 0) {
					const vertexCount = (instance.width + 1) * (instance.height + 1);
					const ofsIndex = dataOffsets.indexOf(instance.offsetVertexData);
					const dataSize = dataOffsets[ofsIndex + 1] - instance.offsetVertexData;

					data.seek(base + instance.offsetVertexData);

					const mtp = dataSize / vertexCount;
					const vertexData = instance.vertexData = {};

					// MTP
					// 5 = Height, Depth
					// 8 = Height, UV
					// 1 = Depth
					// 9 = Height, UV, Depth

					// Height
					if (mtp === 5 || mtp === 8 || mtp === 9)
						vertexData.height = data.readFloat(vertexCount);

					// Texture Coordinates (UV)
					if (mtp === 8 || mtp === 9) {
						const uv = vertexData.uv = new Array(vertexCount);
						for (let i = 0; i < vertexCount; i++) {
							uv[i] = {
								x: data.readUInt16(),
								y: data.readUInt16()
							};
						}
					}

					// Depth
					if (mtp === 5 || mtp === 1 || mtp === 9)
						vertexData.depth = data.readUInt8(vertexCount);
				}
			}
		}
	},

	// MHDR (Header)
	0x4D484452: function(data) {
		this.header = {
			flags: data.readUInt32(),
			ofsMCIN: data.readUInt32(),
			ofsMTEX: data.readUInt32(),
			ofsMMDX: data.readUInt32(),
			ofsMMID: data.readUInt32(),
			ofsMWMO: data.readUInt32(),
			ofsMWID: data.readUInt32(),
			ofsMDDF: data.readUInt32(),
			ofsMODF: data.readUInt32(),
			ofsMFBO: data.readUInt32(),
			ofsMH20: data.readUInt32(),
			ofsMTXF: data.readUInt32(),
			unk: data.readUInt32(4)
		};
	}
};

const RootMCNKChunkHandlers = {
	// MCVT (vertices)
	0x4D435654: function(data) {
		this.vertices = data.readFloat(145);
	},

	// MCCV (Vertex Shading)
	0x4D434356: function(data) {
		const shading = this.vertexShading = new Array(145);
		for (let i = 0; i < 145; i++) {
			shading[i] = {
				r: data.readUInt8(),
				g: data.readUInt8(),
				b: data.readUInt8(),
				a: data.readUInt8()
			};
		}
	},

	// MCNR (Normals)
	0x4D434E52: function(data) {
		const normals = this.normals = new Array(145);
		for (let i = 0; i < 145; i++) {
			const x = data.readInt8();
			const z = data.readInt8();
			const y = data.readInt8();

			normals[i] = [x, y, z];
		}
	},

	// MCBB (Blend Batches)
	0x4D434242: function(data, chunkSize) {
		const count = chunkSize / 20;
		const blend = this.blendBatches = new Array(count);

		for (let i = 0; i < count; i++) {
			blend[i] = {
				mbmhIndex: data.readUInt32(),
				indexCount: data.readUInt32(),
				indexFirst: data.readUInt32(),
				vertexCount: data.readUInt32(),
				vertexFirst: data.readUInt32()
			};
		}
	}
};

const ADTTexChunkHandlers = {
	// MVER (Version)
	0x4D564552: function(data) {
		this.version = data.readUInt32();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MTEX (Textures)
	0x4D544558: function(data, chunkSize) {
		this.textures = data.readStringBlock(chunkSize);
	},

	// MCNK (Texture Chunks)
	0x4D434E4B: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;
		const chunk = this.texChunks[this.chunkIndex++] = {};

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32();
			const subChunkSize = data.readUInt32();
			const nextChunkPos = data.offset + subChunkSize;

			const handler = TexMCNKChunkHandlers[chunkID];
			if (handler)
				handler.call(chunk, data, subChunkSize, this.wdt);

			// Ensure that we start at the next chunk exactly.
			data.seek(nextChunkPos);
		}
	},

	// MTXP
	0x4D545850: function(data, chunkSize) {
		const count = chunkSize / 16;
		const params = this.texParams = new Array(count);

		for (let i = 0; i < count; i++) {
			params[i] = {
				flags: data.readUInt32(),
				height: data.readFloat(),
				offset: data.readFloat(),
				unk3: data.readUInt32()
			};
		}
	},

	// MHID
	0x4D484944: function(data, chunkSize) {
		this.heightTextureFileDataIDs = data.readUInt32(chunkSize / 4);
	},

	// MDID
	0x4D444944: function(data, chunkSize) {
		this.diffuseTextureFileDataIDs = data.readUInt32(chunkSize / 4);
	}
};

const TexMCNKChunkHandlers = {
	// MCLY
	0x4D434C59: function(data, chunkSize) {
		const count = chunkSize / 16;
		const layers = this.layers = new Array(count);

		for (let i = 0; i < count; i++) {
			layers[i] = {
				textureId: data.readUInt32(),
				flags: data.readUInt32(),
				offsetMCAL: data.readUInt32(),
				effectID: data.readInt32()
			};
		}
	},

	// MCAL
	0x4D43414C: function(data, chunkSize, root) {
		const layerCount = this.layers.length;
		const alphaLayers = this.alphaLayers = new Array(layerCount);
		alphaLayers[0] = new Array(64 * 64).fill(255);

		let ofs = 0;
		for (let i = 1; i < layerCount; i++) {
			const layer = this.layers[i];

			if (layer.offsetMCAL !== ofs)
				throw new Error('MCAL offset mis-match');

			if (layer.flags & 0x200) {
				// Compressed.
				const alphaLayer = alphaLayers[i] = new Array(64 * 64);

				let inOfs = 0;
				let outOfs = 0;

				while (outOfs < 4096) {
					const info = data.readUInt8();
					inOfs++;

					const mode = (info & 0x80) >> 7;
					let count = (info & 0x7F);

					if (mode !== 0) {
						const value = data.readUInt8();
						inOfs++;

						while (count-- > 0 && outOfs < 4096) {
							alphaLayer[outOfs] = value;
							outOfs++;
						}
					} else {
						while (count-- > 0 && outOfs < 4096) {
							const value = data.readUInt8();
							inOfs++;

							alphaLayer[outOfs] = value;
							outOfs++;
						}
					}
				}

				ofs += inOfs;
				if (outOfs !== 4096)
					throw new Error('Broken ADT.');
			} else if (root.flags & 0x4 || root.flags & 0x80) {
				// Uncompressed (4096)
				alphaLayers[i] = data.readUInt8(4096);
				ofs += 4096;
			} else {
				// Uncompressed (2048)
				const alphaLayer = alphaLayers[i] = new Array(64 * 64);
				const rawLayer = data.readUInt8(2048);
				ofs += 2048;

				for (let j = 0; j < 2048; j++) {
					alphaLayer[2 * j + 0] = ((rawLayer[j] & 0x0F) >> 0) * 17;
					alphaLayer[2 * j + 1] = ((rawLayer[j] & 0xF0) >> 4) * 17;
				}
			}
		}
	}
};

const ADTObjChunkHandlers = {
	// MVER (Version)
	0x4D564552: function(data) {
		this.version = data.readUInt32();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MMDX (Doodad Filenames)
	0x4D4D4458: function(data, chunkSize) {
		this.m2Names = data.readStringBlock(chunkSize);
	},

	// MMID (M2 Offsets)
	0x4D4D4944: function(data, chunkSize) {
		this.m2Offsets = data.readUInt32(chunkSize / 4);
	},

	// MWMO (WMO Filenames)
	0x4D574D4F: function(data, chunkSize) {
		this.wmoNames = data.readStringBlock(chunkSize);
	},

	// MWID (WMO Offsets)
	0x4D574944: function(data, chunkSize) {
		this.wmoOffsets = data.readUInt32(chunkSize / 4);
	},

	// MDDF
	0x4D444446: function(data, chunkSize) {
		const count = chunkSize / 36;
		const entries = this.models = new Array(count);

		for (let i = 0; i < count; i++) {
			entries[i] = {
				mmidEntry: data.readUInt32(),
				uniqueId: data.readUInt32(),
				position: data.readFloat(3),
				rotation: data.readFloat(3),
				scale: data.readUInt16(),
				flags: data.readUInt16()
			};
		}
	},

	// MODF
	0x4D4F4446: function(data, chunkSize) {
		const count = chunkSize / 64;
		const entries = this.worldModels = new Array(count);

		for (let i = 0; i < count; i++) {
			entries[i] = {
				mwidEntry: data.readUInt32(),
				uniqueId: data.readUInt32(),
				position: data.readFloat(3),
				rotation: data.readFloat(3),
				lowerBounds: data.readFloat(3),
				upperBounds: data.readFloat(3),
				flags: data.readUInt16(),
				doodadSet: data.readUInt16(),
				nameSet: data.readUInt16(),
				scale: data.readUInt16()
			};
		}
	},

	// MWDS
	0x4D574453: function(data, chunkSize) {
		this.doodadSets = data.readUInt16(chunkSize / 2);
	}
};

module.exports = ADTLoader;