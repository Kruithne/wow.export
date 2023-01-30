/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import util from 'node:util';
import * as listfile from '../casc/listfile';
import * as core from '../core';

const MAGIC_SKIN = 0x4E494B53;

export default class Skin {
	fileDataID: number;
	fileName: string;
	isLoaded: boolean = false;
	bones: number;
	indices: number[];
	triangles: number[];
	properties: number[];
	subMeshes: Array<any>; // TODO: Make custom type
	textureUnits: Array<any>; // TODO: Make custom type

	constructor(fileDataID: number) {
		this.fileDataID = fileDataID;
		this.fileName = listfile.getByIDOrUnknown(fileDataID, '.skin');
	}

	async load(): Promise<void> {
		try {
			const data = await core.view.casc.getFile(this.fileDataID);

			const magic = data.readUInt32();
			if (magic !== MAGIC_SKIN)
				throw new Error('Invalid magic: ' + magic);

			const indicesCount = data.readUInt32();
			const indicesOfs = data.readUInt32();
			const trianglesCount = data.readUInt32();
			const trianglesOfs = data.readUInt32();
			const propertiesCount = data.readUInt32();
			const propertiesOfs = data.readUInt32();
			const subMeshesCount = data.readUInt32();
			const subMeshesOfs = data.readUInt32();
			const textureUnitsCount = data.readUInt32();
			const textureUnitsOfs = data.readUInt32();
			this.bones = data.readUInt32();

			// Read indices.
			data.seek(indicesOfs);
			this.indices = data.readUInt16(indicesCount);

			// Read triangles.
			data.seek(trianglesOfs);
			this.triangles = data.readUInt16(trianglesCount);

			// Read properties.
			data.seek(propertiesOfs);
			this.properties = data.readUInt8(propertiesCount);

			// Read subMeshes.
			data.seek(subMeshesOfs);
			this.subMeshes = new Array(subMeshesCount);
			for (let i = 0; i < subMeshesCount; i++) {
				this.subMeshes[i] = {
					submeshID: data.readUInt16(),
					level: data.readUInt16(),
					vertexStart: data.readUInt16(),
					vertexCount: data.readUInt16(),
					triangleStart: data.readUInt16(),
					triangleCount: data.readUInt16(),
					boneCount: data.readUInt16(),
					boneStart: data.readUInt16(),
					boneInfluences: data.readUInt16(),
					centerBoneIndex: data.readUInt16(),
					centerPosition: data.readFloat(3),
					sortCenterPosition: data.readFloat(3),
					sortRadius: data.readFloat()
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
					shaderID: data.readUInt16(),
					skinSectionIndex: data.readUInt16(),
					geosetIndex: data.readUInt16(),
					colorIndex: data.readUInt16(),
					materialIndex: data.readUInt16(),
					materialLayer: data.readUInt16(),
					textureCount: data.readUInt16(),
					textureComboIndex: data.readUInt16(),
					textureCoordComboIndex: data.readUInt16(),
					textureWeightComboIndex: data.readUInt16(),
					textureTransformComboIndex: data.readUInt16()
				};
			}

			this.isLoaded = true;
		} catch (e) {
			throw new Error(util.format('Unable to load skin fileDataID %d: %s', this.fileDataID, e.message));
		}
	}
}