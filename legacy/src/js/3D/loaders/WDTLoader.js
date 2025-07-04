/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const constants = require('../../constants');

const MAP_SIZE = constants.GAME.MAP_SIZE;
const MAP_SIZE_SQ = constants.GAME.MAP_SIZE_SQ;

class WDTLoader {
	/**
	 * Construct a new WDTLoader instance.
	 * @param {BufferWrapper} data 
	 */
	constructor(data) {
		this.data = data;
	}

	/**
	 * Load the WDT file, parsing it.
	 */
	load() {
		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32LE();
			const chunkSize = this.data.readUInt32LE();
			const nextChunkPos = this.data.offset + chunkSize;

			const handler = WDTChunkHandlers[chunkID];
			if (handler)
				handler.call(this, this.data, chunkSize);
	
			// Ensure that we start at the next chunk exactly.
			this.data.seek(nextChunkPos);
		}
	}
}

const WDTChunkHandlers = {
	// MPHD (Flags)
	0x4D504844: function(data) {
		this.flags = data.readUInt32LE();
		this.lgtFileDataID = data.readUInt32LE();
		this.occFileDataID = data.readUInt32LE();
		this.fogsFileDataID = data.readUInt32LE();
		this.mpvFileDataID = data.readUInt32LE();
		this.texFileDataID = data.readUInt32LE();
		this.wdlFileDataID = data.readUInt32LE();
		this.pd4FileDataID = data.readUInt32LE();
	},

	// MAIN (Tiles)
	0x4D41494E: function(data) {
		const tiles = this.tiles = new Array(MAP_SIZE_SQ);
		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				tiles[(y * MAP_SIZE) + x] = data.readUInt32LE();
				data.move(4);
			}
		}
	},

	// MAID (File IDs)
	0x4D414944: function(data) {
		const entries = this.entries = new Array(MAP_SIZE_SQ);

		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				entries[(y * MAP_SIZE) + x] = {
					rootADT: data.readUInt32LE(),
					obj0ADT: data.readUInt32LE(),
					obj1ADT: data.readUInt32LE(),
					tex0ADT: data.readUInt32LE(),
					lodADT: data.readUInt32LE(),
					mapTexture: data.readUInt32LE(),
					mapTextureN: data.readUInt32LE(),
					minimapTexture: data.readUInt32LE()
				};
			}
		}
	},

	// MWMO (World WMO)
	0x4D574D4F: function(data, chunkSize) {
		this.worldModel = data.readString(chunkSize).replace('\0', '');
	},

	// MODF (World WMO Placement)
	0x4D4F4446: function(data) {
		this.worldModelPlacement = {
			id: data.readUInt32LE(),
			uid: data.readUInt32LE(),
			position: data.readFloatLE(3),
			rotation: data.readFloatLE(3),
			upperExtents: data.readFloatLE(3),
			lowerExtents: data.readFloatLE(3),
			flags: data.readUInt16LE(),
			doodadSetIndex: data.readUInt16LE(),
			nameSet: data.readUInt16LE(),
			padding: data.readUInt16LE()
		};
	}
};

module.exports = WDTLoader;