/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const LoaderGenerics = require('./LoaderGenerics');

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
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
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
		this.version = data.readUInt32LE();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MCNK
	0x4D434E4B: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;
		const chunk = this.chunks[this.chunkIndex++] = {
			flags: data.readUInt32LE(),
			indexX: data.readUInt32LE(),
			indexY: data.readUInt32LE(),
			nLayers: data.readUInt32LE(),
			nDoodadRefs: data.readUInt32LE(),
			holesHighRes: data.readUInt8(8),
			ofsMCLY: data.readUInt32LE(),
			ofsMCRF: data.readUInt32LE(),
			ofsMCAL: data.readUInt32LE(),
			sizeAlpha: data.readUInt32LE(),
			ofsMCSH: data.readUInt32LE(),
			sizeShadows: data.readUInt32LE(),
			areaID: data.readUInt32LE(),
			nMapObjRefs: data.readUInt32LE(),
			holesLowRes: data.readUInt16LE(),
			unk1: data.readUInt16LE(),
			lowQualityTextureMap: data.readInt16LE(8),
			noEffectDoodad: data.readInt64LE(),
			ofsMCSE: data.readUInt32LE(),
			numMCSE: data.readUInt32LE(),
			ofsMCLQ: data.readUInt32LE(),
			sizeMCLQ: data.readUInt32LE(),
			position: data.readFloatLE(3),
			ofsMCCV: data.readUInt32LE(),
			ofsMCLW: data.readUInt32LE(),
			unk2: data.readUInt32LE()
		};

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32LE();
			const subChunkSize = data.readUInt32LE();
			const nextChunkPos = data.offset + subChunkSize;

			const handler = RootMCNKChunkHandlers[chunkID];
			if (handler)
				handler.call(chunk, data, subChunkSize);
	
			// Ensure that we start at the next chunk exactly.
			data.seek(nextChunkPos);
		}
	},

	// MH2O (Liquids)
	0x4D48324F: function(data, chunkSize) {
		const base = data.offset;
		const chunkEnd = base + chunkSize;
		const dataOffsets = new Set();

		const chunkHeaders = new Array(256);
		const chunks = this.liquidChunks = new Array(256);
		
		for (let i = 0; i < 256; i++) {
			chunkHeaders[i] = {
				offsetInstances: data.readUInt32LE(),
				layerCount: data.readUInt32LE(),
				offsetAttributes: data.readUInt32LE()
			};

			if (chunkHeaders[i].offsetAttributes > 0)
				dataOffsets.add(chunkHeaders[i].offsetAttributes);

			chunks[i] = {
				attributes: { fishable: 0, deep: 0 },
				instances: new Array(chunkHeaders[i].layerCount)
			};
		}

		const allInstances = [];
		for (let i = 0; i < 256; i++) {
			const header = chunkHeaders[i];
			const chunk = chunks[i];

			if (header.layerCount > 0) {
				data.seek(base + header.offsetInstances);
				
				for (let j = 0; j < header.layerCount; j++) {
					const instance = {
						chunkIndex: i,
						instanceIndex: j,
						liquidType: data.readUInt16LE(),
						liquidObject: data.readUInt16LE(),
						minHeightLevel: data.readFloatLE(),
						maxHeightLevel: data.readFloatLE(),
						xOffset: data.readUInt8(),
						yOffset: data.readUInt8(),
						width: data.readUInt8(),
						height: data.readUInt8(),
						bitmap: [],
						vertexData: {},
						offsetExistsBitmap: data.readUInt32LE(),
						offsetVertexData: data.readUInt32LE()
					};

					// default values for liquidObject <= 41
					if (instance.liquidObject <= 41) {
						instance.xOffset = 0;
						instance.yOffset = 0;
						instance.width = 8;
						instance.height = 8;
					}

					if (instance.offsetExistsBitmap > 0)
						dataOffsets.add(instance.offsetExistsBitmap);

					if (instance.offsetVertexData > 0)
						dataOffsets.add(instance.offsetVertexData);

					chunk.instances[j] = instance;
					allInstances.push(instance);
				}
			}
		}

		const sortedOffsets = Array.from(dataOffsets).sort((a, b) => a - b);

		for (let i = 0; i < 256; i++) {
			const header = chunkHeaders[i];
			const chunk = chunks[i];

			if (header.offsetAttributes > 0) {
				data.seek(base + header.offsetAttributes);
				chunk.attributes.fishable = data.readUInt64LE();
				chunk.attributes.deep = data.readUInt64LE();
			}
		}

		for (const instance of allInstances) {
			if (instance.offsetExistsBitmap > 0) {
				data.seek(base + instance.offsetExistsBitmap);
				const bitmapSize = Math.ceil((instance.width * instance.height + 7) / 8);
				instance.bitmap = data.readUInt8(bitmapSize);
			}

			// Handle special case: if offsetVertexData is 0, no vertex data in file
			if (instance.offsetVertexData === 0) {
				const vertexCount = (instance.width + 1) * (instance.height + 1);
				// ocean liquid (type 2) with no vertex data: flat surface at sea level or min/max average
				const waterLevel = instance.minHeightLevel === 0 && instance.maxHeightLevel === 0 ? 0.0 : (instance.minHeightLevel + instance.maxHeightLevel) / 2;
				instance.vertexData = { height: new Array(vertexCount).fill(waterLevel) };
			} else if (instance.offsetVertexData > 0) {
				const vertexCount = (instance.width + 1) * (instance.height + 1);
				const offsetIndex = sortedOffsets.indexOf(instance.offsetVertexData);
				let dataSize;

				// Calculate data size using next offset
				if (offsetIndex < sortedOffsets.length - 1) {
					dataSize = sortedOffsets[offsetIndex + 1] - instance.offsetVertexData;
				} else {
					// last data block: use remaining bytes in chunk
					dataSize = chunkEnd - (base + instance.offsetVertexData);
				}

				data.seek(base + instance.offsetVertexData);

				const bytesPerVertex = dataSize / vertexCount;
				const vertexData = instance.vertexData = {};

				if (bytesPerVertex === 5) {
					// Case 0: Height + Depth (5 bytes per vertex)
					vertexData.height = data.readFloatLE(vertexCount);
					vertexData.depth = data.readUInt8(vertexCount);
				} else if (bytesPerVertex === 8) {
					// Case 1: Height + UV (8 bytes per vertex) 
					vertexData.height = data.readFloatLE(vertexCount);
					const uv = vertexData.uv = new Array(vertexCount);
					for (let i = 0; i < vertexCount; i++) {
						uv[i] = {
							x: data.readUInt16LE(),
							y: data.readUInt16LE()
						};
					}
				} else if (bytesPerVertex === 1) {
					// Case 2: Depth only (1 byte per vertex)
					vertexData.depth = data.readUInt8(vertexCount);
					// ocean liquid: height is constant at minHeightLevel (typically 0.0 for sea level)
					const waterLevel = instance.minHeightLevel === 0 && instance.maxHeightLevel === 0 ? 0.0 : (instance.minHeightLevel + instance.maxHeightLevel) / 2;
					vertexData.height = new Array(vertexCount).fill(waterLevel);
				} else if (bytesPerVertex === 9) {
					// Case 3: Height + UV + Depth (9 bytes per vertex)
					vertexData.height = data.readFloatLE(vertexCount);
					const uv = vertexData.uv = new Array(vertexCount);
					for (let i = 0; i < vertexCount; i++) {
						uv[i] = {
							x: data.readUInt16LE(),
							y: data.readUInt16LE()
						};
					}
					vertexData.depth = data.readUInt8(vertexCount);
				}
			}
		}
	},

	// MHDR (Header)
	0x4D484452: function(data) {
		this.header = {
			flags: data.readUInt32LE(),
			ofsMCIN: data.readUInt32LE(),
			ofsMTEX: data.readUInt32LE(),
			ofsMMDX: data.readUInt32LE(),
			ofsMMID: data.readUInt32LE(),
			ofsMWMO: data.readUInt32LE(),
			ofsMWID: data.readUInt32LE(),
			ofsMDDF: data.readUInt32LE(),
			ofsMODF: data.readUInt32LE(),
			ofsMFBO: data.readUInt32LE(),
			ofsMH20: data.readUInt32LE(),
			ofsMTXF: data.readUInt32LE(),
			unk: data.readUInt32LE(4)
		};
	}
};

const RootMCNKChunkHandlers = {
	// MCVT (vertices)
	0x4D435654: function(data) {
		this.vertices = data.readFloatLE(145);
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
			}
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
				mbmhIndex: data.readUInt32LE(),
				indexCount: data.readUInt32LE(),
				indexFirst: data.readUInt32LE(),
				vertexCount: data.readUInt32LE(),
				vertexFirst: data.readUInt32LE()
			};
		}
	}
};

const ADTTexChunkHandlers = {
	// MVER (Version)
	0x4D564552: function(data) {
		this.version = data.readUInt32LE();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MTEX (Textures)
	0x4D544558: function(data, chunkSize) {
		this.textures = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MCNK (Texture Chunks)
	0x4D434E4B: function(data, chunkSize) {
		const endOfs = data.offset + chunkSize;
		const chunk = this.texChunks[this.chunkIndex++] = {};

		// Read sub-chunks.
		while (data.offset < endOfs) {
			const chunkID = data.readUInt32LE();
			const subChunkSize = data.readUInt32LE();
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
				flags: data.readUInt32LE(),
				height: data.readFloatLE(),
				offset: data.readFloatLE(),
				unk3: data.readUInt32LE()
			};
		}
	},

	// MHID
	0x4D484944: function(data, chunkSize) {
		this.heightTextureFileDataIDs = data.readUInt32LE(chunkSize / 4);
	},

	// MDID
	0x4D444944: function(data, chunkSize) {
		this.diffuseTextureFileDataIDs = data.readUInt32LE(chunkSize / 4);
	}
};

const TexMCNKChunkHandlers = {
	// MCLY
	0x4D434C59: function(data, chunkSize) {
		const count = chunkSize / 16;
		const layers = this.layers = new Array(count);
		this.layerCount = count;

		for (let i = 0; i < count; i++) {
			layers[i] = {
				textureId: data.readUInt32LE(),
				flags: data.readUInt32LE(),
				offsetMCAL: data.readUInt32LE(),
				effectID: data.readInt32LE()
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
		this.version = data.readUInt32LE();
		if (this.version !== 18)
			throw new Error('Unexpected ADT version: ' + this.version);
	},

	// MMDX (Doodad Filenames)
	0x4D4D4458: function(data, chunkSize) {
		this.m2Names = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MMID (M2 Offsets)
	0x4D4D4944: function(data, chunkSize) {
		this.m2Offsets = data.readUInt32LE(chunkSize / 4);
	},

	// MWMO (WMO Filenames)
	0x4D574D4F: function(data, chunkSize) {
		this.wmoNames = LoaderGenerics.ReadStringBlock(data, chunkSize);
	},

	// MWID (WMO Offsets)
	0x4D574944: function(data, chunkSize) {
		this.wmoOffsets = data.readUInt32LE(chunkSize / 4);
	},

	// MDDF
	0x4D444446: function(data, chunkSize) {
		const count = chunkSize / 36;
		const entries = this.models = new Array(count);

		for (let i = 0; i < count; i++) {
			entries[i] = {
				mmidEntry: data.readUInt32LE(),
				uniqueId: data.readUInt32LE(),
				position: data.readFloatLE(3),
				rotation: data.readFloatLE(3),
				scale: data.readUInt16LE(),
				flags: data.readUInt16LE()
			};
		}
	},

	// MODF
	0x4D4F4446: function(data, chunkSize) {
		const count = chunkSize / 64;
		const entries = this.worldModels = new Array(count);

		for (let i = 0; i < count; i++) {
			entries[i] = {
				mwidEntry: data.readUInt32LE(),
				uniqueId: data.readUInt32LE(),
				position: data.readFloatLE(3),
				rotation: data.readFloatLE(3),
				lowerBounds: data.readFloatLE(3),
				upperBounds: data.readFloatLE(3),
				flags: data.readUInt16LE(),
				doodadSet: data.readUInt16LE(),
				nameSet: data.readUInt16LE(),
				scale: data.readUInt16LE()
			};
		}
	},

	// MWDS
	0x4D574453: function(data, chunkSize) {
		this.doodadSets = data.readUInt16LE(chunkSize / 2);
	}
};

module.exports = ADTLoader;