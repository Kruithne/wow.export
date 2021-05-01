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