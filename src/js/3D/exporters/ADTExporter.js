const util = require('util');
const core = require('../../core');
const constants = require('../../constants');
const listfile = require('../../casc/listfile');

const WDTLoader = require('../loaders/WDTLoader');
const ADTLoader = require('../loaders/ADTLoader');

const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');

const MAP_SIZE = constants.GAME.MAP_SIZE;
//const MAX_SIZE = constants.GAME.MAP_COORD_BASE;
const TILE_SIZE = constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const wdtCache = new Map();

class ADTExporter {
	/**
	 * Construct a new ADTLoader instance.
	 * @param {number} mapID 
	 * @param {string} mapDir 
	 * @param {number} tileIndex 
	 */
	constructor(mapID, mapDir, tileIndex) {
		this.mapID = mapID;
		this.mapDir = mapDir;
		this.tileX = tileIndex % MAP_SIZE;
		this.tileY = Math.floor(tileIndex / MAP_SIZE);
		this.tileID = this.tileX + '_' + this.tileY;
		this.tileIndex = tileIndex;
	}

	/**
	 * Export the ADT tile.
	 * @param {string} dir Directory to export the tile into.
	 * @param {number} textureRes
	 */
	async export(dir, quality) {
		const casc = core.view.casc;
		const prefix = util.format('world/maps/%s/%s', this.mapDir, this.mapDir);

		// Load the WDT. We cache this to speed up exporting large amounts of tiles
		// from the same map. Make sure ADTLoader.clearCache() is called after exporting.
		let wdt = wdtCache.get(this.mapDir);
		if (!wdt) {
			wdt = new WDTLoader(await casc.getFileByName(prefix + '.wdt'));
			await wdt.load();
			wdtCache.set(this.mapDir, wdt);
		}

		console.log(wdt);
		const tilePrefix = prefix + '_' + this.tileID;

		const maid = wdt.entries[this.tileIndex];
		const rootFileDataID = maid.rootADT > 0 ? maid.rootADT : listfile.getByFilename(tilePrefix + '.adt');
		const tex0FileDataID = maid.tex0ADT > 0 ? maid.tex0ADT : listfile.getByFilename(tilePrefix + '_obj0.adt');
		const obj0FileDataID = maid.obj0ADT > 0 ? maid.obj0ADT : listfile.getByFilename(tilePrefix + '_tex0.adt');

		// Ensure we actually have the fileDataIDs for the files we need.
		if (rootFileDataID === 0 || tex0FileDataID === 0 || obj0FileDataID === 0)
			throw new Error('Missing fileDataID for ADT files: ' + [rootFileDataID, tex0FileDataID, obj0FileDataID].join(', '));

		const rootAdt = new ADTLoader(await casc.getFile(rootFileDataID));
		rootAdt.loadRoot();

		const texAdt = new ADTLoader(await casc.getFile(tex0FileDataID));
		texAdt.loadTex(wdt);

		const objAdt = new ADTLoader(await casc.getFile(obj0FileDataID));
		objAdt.loadObj();

		const verticies = new Array(16 * 16 * 145 * 3);
		const normals = new Array(16 * 16 * 145 * 3);
		const uvs = new Array(16 * 16 * 145 * 2);

		const obj = new OBJWriter(path.join(dir, 'adt_' + this.tileID + '.obj'));
		const mtl = new MTLWriter(path.join(dir, 'adt_' + this.tileID + '.mtl'));

		const firstChunk = rootAdt.chunks[0];
		const firstChunkX = firstChunk.position[0];
		const firstChunkY = firstChunk.position[1];

		const splitTextures = quality >= 16384;
	
		let ofs = 0;
		let chunkID = 0;
		for (let x = 0, midx = 0; x < 16; x++) {
			for (let y = 0; y < 16; y++) {
				const indicies = [];

				const chunkIndex = (x * 16) + y;
				const chunk = rootAdt.chunks[chunkIndex];

				const chunkX = chunk.position[0];
				const chunkY = chunk.position[1];
				const chunkZ = chunk.position[2];

				for (let col = 0, idx = 0; col < 17; col++) {
					const isShort = !!(col % 2);
					const rowLength = isShort ? 8 : 9;

					for (let row = 0; row < rowLength; row++) {
						let vx = chunkY - (row * UNIT_SIZE);
						let vy = chunk.verticies[idx] + chunkZ;
						let vz = chunkX - (col * UNIT_SIZE_HALF);

						if (isShort)
							vx -= UNIT_SIZE_HALF;

						const vIndex = midx * 3;
						verticies[vIndex + 0] = vx;
						verticies[vIndex + 1] = vy;
						verticies[vIndex + 2] = vz;

						const normal = chunk.normals[idx];
						normals[vIndex + 0] = normal[0] / 127;
						normals[vIndex + 1] = normal[1] / 127;
						normals[vIndex + 2] = normal[2] / 127;

						const uvIdx = isShort ? row + 0.5 : row;
						const uvIndex = midx * 2;

						if (quality === 0) {
							uvs[uvIndex + 0] = uvIdx / 8;
							uvs[uvIndex + 1] = (col * 0.5) / 8;
						} else if (splitTextures) {
							uvs[uvIndex + 0] = row / 8;
							uvs[uvIndex + 1] = 1 - (col / 16);
						} else {
							uvs[uvIndex + 0] = -(vx - firstChunkX) / TILE_SIZE;
							uvs[uvIndex + 1] = (vz - firstChunkY) / TILE_SIZE;
						}

						idx++;
						midx++;
					}
				}

				const holesHighRes = chunk.holesHighRes;
				for (let j = 9, xx = 0, yy = 0; j < 145; j++, xx++) {
					if (xx >= 8) {
						xx = 0;
						yy++;
					}

					let isHole = true;
					if (!(chunk.flags & 0x10000)) {
						const current = Math.pow(2, Math.floor(xx / 2) + Math.floor(yy / 4));

						if (!(chunk.holesLowRes & current))
							isHole = false;
					} else {
						if (!((holesHighRes[yy] >> xx) & 1))
							isHole = false;
					}

					if (!isHole) {
						const indOfs = ofs + j;
						indicies.push(indOfs + 8, indOfs - 9, indOfs);
						indicies.push(indOfs - 9, indOfs - 8, indOfs);
						indicies.push(indOfs - 8, indOfs + 9, indOfs);
						indicies.push(indOfs + 9, indOfs + 8, indOfs);
					}

					if (!((j + 1) % (9 + 8)))
						j += 9;
				}
			
				ofs = midx;
				console.log(indicies);

				if (splitTextures)
					mtl.addMaterial(chunkID, 'tex_' + this.tileID + '_' + chunkID + '.png');

				obj.addMesh(chunkID++, indicies, splitTextures ? chunkID : 'terrain');
			}
		}

		if (!splitTextures)
			mtl.addMaterial('terrain', 'tex_' + this.tileID + '.png');

		obj.setVertArray(verticies);
		obj.setNormalArray(normals);
		obj.setUVArray(uvs);

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));
		
		await obj.write();
		await mtl.write();

		console.log(rootAdt, texAdt, objAdt);
		console.log(verticies, normals, uvs);
	}

	/**
	 * Clear internal tile-loading cache.
	 */
	static clearCache() {
		wdtCache.clear();
	}
}

module.exports = ADTExporter;