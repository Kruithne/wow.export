/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import BufferWrapper from '../../buffer';
import Constants from '../../constants';

const MAP_SIZE = Constants.GAME.MAP_SIZE;
const MAP_SIZE_SQ = Constants.GAME.MAP_SIZE_SQ;

export default class WDTLoader {
	data: BufferWrapper;

	/**
	 * Construct a new WDTLoader instance.
	 * @param {BufferWrapper} data
	 */
	constructor(data: BufferWrapper) {
		this.data = data;
	}

	/**
	 * Load the WDT file, parsing it.
	 */
	load() {
		while (this.data.remainingBytes > 0) {
			const chunkID = this.data.readUInt32();
			const chunkSize = this.data.readUInt32();
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
	0x4D504844: function(data: BufferWrapper) {
		this.flags = data.readUInt32();
		// 7 * UInt32 fileDataIDs
	},

	// MAIN (Tiles)
	0x4D41494E: function(data: BufferWrapper) {
		const tiles = this.tiles = new Array(MAP_SIZE_SQ);
		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				tiles[(y * MAP_SIZE) + x] = data.readUInt32();
				data.move(4);
			}
		}
	},

	// MAID (File IDs)
	0x4D414944: function(data: BufferWrapper) {
		const entries = this.entries = new Array(MAP_SIZE_SQ);

		for (let x = 0; x < MAP_SIZE; x++) {
			for (let y = 0; y < MAP_SIZE; y++) {
				entries[(y * MAP_SIZE) + x] = {
					rootADT: data.readUInt32(),
					obj0ADT: data.readUInt32(),
					obj1ADT: data.readUInt32(),
					tex0ADT: data.readUInt32(),
					lodADT: data.readUInt32(),
					mapTexture: data.readUInt32(),
					mapTextureN: data.readUInt32(),
					minimapTexture: data.readUInt32()
				};
			}
		}
	},

	// MWMO (World WMO)
	0x4D574D4F: function(data: BufferWrapper, chunkSize: number) {
		this.worldModel = data.readString(chunkSize).replace('\0', '');
	},

	// MODF (World WMO Placement)
	0x4D4F4446: function(data: BufferWrapper) {
		this.worldModelPlacement = {
			id: data.readUInt32(),
			uid: data.readUInt32(),
			position: data.readFloat32Array(3),
			rotation: data.readFloat32Array(3),
			upperExtents: data.readFloat32Array(3),
			lowerExtents: data.readFloat32Array(3),
			flags: data.readUInt16(),
			doodadSetIndex: data.readUInt16(),
			nameSet: data.readUInt16(),
			padding: data.readUInt16()
		};
	}
};