/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const util = require('util');
const listfile = require('../casc/listfile');
const core = require('../core');

const MAGIC_SKIN = 0x4E494B53;

class Skin {
	constructor(fileDataID) {
		this.fileDataID = fileDataID;
		this.fileName = listfile.getByIDOrUnknown(fileDataID, '.skin');
		this.isLoaded = false;
	}

	async load() {
		try {
			const data = await core.view.casc.getFile(this.fileDataID);

			const magic = data.readUInt32LE();
			if (magic !== MAGIC_SKIN)
				throw new Error('Invalid magic: ' + magic);

			const indicesCount = data.readUInt32LE();
			const indicesOfs = data.readUInt32LE();
			const trianglesCount = data.readUInt32LE();
			const trianglesOfs = data.readUInt32LE();
			const propertiesCount = data.readUInt32LE();
			const propertiesOfs = data.readUInt32LE();
			const subMeshesCount = data.readUInt32LE();
			const subMeshesOfs = data.readUInt32LE();
			const textureUnitsCount = data.readUInt32LE();
			const textureUnitsOfs = data.readUInt32LE();
			this.bones = data.readUInt32LE();

			// Read indices.
			data.seek(indicesOfs);
			this.indices = data.readUInt16LE(indicesCount);

			// Read triangles.
			data.seek(trianglesOfs);
			this.triangles = data.readUInt16LE(trianglesCount);

			// Read properties.
			data.seek(propertiesOfs);
			this.properties = data.readUInt8(propertiesCount);

			// Read subMeshes.
			data.seek(subMeshesOfs);
			this.subMeshes = new Array(subMeshesCount);
			for (let i = 0; i < subMeshesCount; i++) {
				this.subMeshes[i] = {
					submeshID: data.readUInt16LE(),
					level: data.readUInt16LE(),
					vertexStart: data.readUInt16LE(),
					vertexCount: data.readUInt16LE(),
					triangleStart: data.readUInt16LE(),
					triangleCount: data.readUInt16LE(),
					boneCount: data.readUInt16LE(),
					boneStart: data.readUInt16LE(),
					boneInfluences: data.readUInt16LE(),
					centerBoneIndex: data.readUInt16LE(),
					centerPosition: data.readFloatLE(3),
					sortCenterPosition: data.readFloatLE(3),
					sortRadius: data.readFloatLE()
				};

				this.subMeshes[i].triangleStart += this.subMeshes[i].level << 16;
			}

			// Read texture units.
			data.seek(textureUnitsOfs);
			this.textureUnits = new Array(textureUnitsCount);
			for (let i = 0; i < textureUnitsCount; i++) {
				this.textureUnits[i] = {
					flags: data.readUInt8(),
					priority: data.readUInt8(),
					shaderID: data.readUInt16LE(),
					skinSectionIndex: data.readUInt16LE(),
					geosetIndex: data.readUInt16LE(),
					colorIndex: data.readUInt16LE(),
					materialIndex: data.readUInt16LE(),
					materialLayer: data.readUInt16LE(),
					textureCount: data.readUInt16LE(),
					textureComboIndex: data.readUInt16LE(),
					textureCoordComboIndex: data.readUInt16LE(),
					textureWeightComboIndex: data.readUInt16LE(),
					textureTransformComboIndex: data.readUInt16LE()
				};
			}

			this.isLoaded = true;
		} catch (e) {
			throw new Error(util.format('Unable to load skin fileDataID %d: %s', this.fileDataID, e.message));
		}
	}
}

module.exports = Skin;