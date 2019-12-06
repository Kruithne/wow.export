const M2Loader = require('../loaders/M2Loader');
const OBJWriter = require('../writers/OBJWriter');
const GeosetMapper = require('../GeosetMapper');

class M2Exporter {
	/**
	 * Construct a new M2Exporter instance.
	 * @param {BufferWrapper}
	 */
	constructor(data) {
		this.m2 = new M2Loader(data);
	}

	/**
	 * Set the mask array used for geoset control.
	 * @param {Array} mask 
	 */
	setGeosetMask(mask) {
		this.geosetMask = mask;
	}

	/**
	 * Export the M2 model as a WaveFront OBJ.
	 * @param {string} out
	 */
	async exportAsOBJ(out) {
		await this.m2.load();
		const skin = await this.m2.getSkin(0);

		const writer = new OBJWriter(out);
		writer.setVertArray(this.m2.vertices);
		writer.setNormalArray(this.m2.normals);
		writer.setUVArray(this.m2.uv);

		for (let mI = 0, mC = skin.submeshes.length; mI < mC; mI++) {
			const mesh = skin.submeshes[mI];
			const verts = new Array(mesh.triangleCount);
			for (let vI = 0; vI < mesh.triangleCount; vI++)
				verts[vI] = skin.indicies[skin.triangles[mesh.triangleStart + vI]];

			writer.addMesh(GeosetMapper.getGeosetName(mI, mesh.submeshID), verts);
		}

		await writer.write();
	}
}

module.exports = M2Exporter;