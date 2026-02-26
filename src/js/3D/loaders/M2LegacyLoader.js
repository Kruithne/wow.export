/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/



import Texture from '../Texture.js';

const MAGIC_MD20 = 0x3032444D; // 'MD20'

// m2 version constants
const M2_VER_VANILLA_MIN = 256;
const M2_VER_VANILLA_MAX = 257;
const M2_VER_TBC_MIN = 260;
const M2_VER_TBC_MAX = 263;
const M2_VER_WOTLK = 264;

class M2Track {
	constructor(globalSeq, interpolation, timestamps, values, ranges = null) {
		this.globalSeq = globalSeq;
		this.interpolation = interpolation;
		this.timestamps = timestamps;
		this.values = values;
		this.ranges = ranges; // legacy only: animation ranges for single-timeline
	}
}

class M2LegacyLoader {
	constructor(data) {
		this.data = data;
		this.isLoaded = false;
	}

	async load() {
		if (this.isLoaded)
			return;

		const data = this.data;

		const magic = data.readUInt32LE();
		if (magic !== MAGIC_MD20)
			throw new Error('Invalid M2 magic: 0x' + magic.toString(16));

		this.version = data.readUInt32LE();

		if (this.version < M2_VER_VANILLA_MIN || this.version > M2_VER_WOTLK)
			throw new Error('Unsupported M2 version: ' + this.version);

		this._parse_header();
		this.isLoaded = true;
	}

	_parse_header() {
		const data = this.data;
		const ofs = 0; // legacy m2 has no chunk wrapper, offsets are from file start

		this._parse_model_name(ofs);
		this.flags = data.readUInt32LE();
		this._parse_global_loops(ofs);
		this._parse_animations(ofs);
		this._parse_animation_lookup(ofs);

		// playable animation lookup (vanilla only)
		if (this.version <= M2_VER_VANILLA_MAX)
			this._parse_playable_animation_lookup(ofs);

		this._parse_bones(ofs);

		// key bone lookup
		data.move(8);

		this._parse_vertices(ofs);

		// views (skins) - inline for pre-wotlk
		if (this.version < M2_VER_WOTLK)
			this._parse_views_inline(ofs);
		else
			this.viewCount = data.readUInt32LE();

		this._parse_colors(ofs);
		this._parse_textures(ofs);
		this._parse_texture_weights(ofs);

		// texture flipbooks (vanilla only)
		if (this.version <= M2_VER_VANILLA_MAX)
			data.move(8);

		this._parse_texture_transforms(ofs);
		this._parse_replaceable_texture_lookup(ofs);
		this._parse_materials(ofs);

		// bone combos
		data.move(8);

		this._parse_texture_combos(ofs);

		// texture transform bone map
		data.move(8);

		this._parse_transparency_lookup(ofs);
		this._parse_texture_transform_lookup(ofs);
		this._parse_bounding_box();
		this._parse_collision(ofs);
		this._parse_attachments(ofs);
	}

	_parse_model_name(ofs) {
		const data = this.data;
		const nameLength = data.readUInt32LE();
		const nameOfs = data.readUInt32LE();

		const base = data.offset;
		data.seek(nameOfs + ofs);
		this.name = data.readString(nameLength > 0 ? nameLength - 1 : 0);
		data.seek(base);
	}

	_parse_global_loops(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.globalLoops = data.readUInt32LE(count);
		data.seek(base);
	}

	_parse_animations(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.animations = new Array(count);

		for (let i = 0; i < count; i++) {
			if (this.version < M2_VER_WOTLK) {
				// pre-wotlk: single timeline with start/end timestamps
				this.animations[i] = {
					id: data.readUInt16LE(),
					variationIndex: data.readUInt16LE(),
					startTimestamp: data.readUInt32LE(),
					endTimestamp: data.readUInt32LE(),
					movespeed: data.readFloatLE(),
					flags: data.readUInt32LE(),
					frequency: data.readInt16LE(),
					padding: data.readUInt16LE(),
					replayMin: data.readUInt32LE(),
					replayMax: data.readUInt32LE(),
					blendTime: data.readUInt32LE(),
					boxMin: data.readFloatLE(3),
					boxMax: data.readFloatLE(3),
					boxRadius: data.readFloatLE(),
					variationNext: data.readInt16LE(),
					aliasNext: data.readUInt16LE()
				};

				// compute duration from timestamps
				this.animations[i].duration = this.animations[i].endTimestamp - this.animations[i].startTimestamp;
			} else {
				// wotlk: per-animation timeline with duration
				this.animations[i] = {
					id: data.readUInt16LE(),
					variationIndex: data.readUInt16LE(),
					duration: data.readUInt32LE(),
					movespeed: data.readFloatLE(),
					flags: data.readUInt32LE(),
					frequency: data.readInt16LE(),
					padding: data.readUInt16LE(),
					replayMin: data.readUInt32LE(),
					replayMax: data.readUInt32LE(),
					blendTimeIn: data.readUInt16LE(),
					blendTimeOut: data.readUInt16LE(),
					boxMin: data.readFloatLE(3),
					boxMax: data.readFloatLE(3),
					boxRadius: data.readFloatLE(),
					variationNext: data.readInt16LE(),
					aliasNext: data.readUInt16LE()
				};
			}
		}

		data.seek(base);
	}

	_parse_animation_lookup(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.animationLookup = data.readInt16LE(count);
		data.seek(base);
	}

	_parse_playable_animation_lookup(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		// playable animation lookup: fallback animation id + flags
		this.playableAnimationLookup = new Array(count);
		for (let i = 0; i < count; i++) {
			this.playableAnimationLookup[i] = {
				fallbackAnimationId: data.readUInt16LE(),
				flags: data.readUInt16LE()
			};
		}

		data.seek(base);
	}

	_parse_bones(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.bones = new Array(count);

		for (let i = 0; i < count; i++) {
			const bone = {
				boneID: data.readInt32LE(),
				flags: data.readUInt32LE(),
				parentBone: data.readInt16LE(),
				subMeshID: data.readUInt16LE()
			};

			// bone name crc added in tbc
			if (this.version >= M2_VER_TBC_MIN)
				bone.boneNameCRC = data.readUInt32LE();

			bone.translation = this._read_m2_track(data, ofs, 'float3');
			bone.rotation = this._read_m2_track(data, ofs, 'compquat');
			bone.scale = this._read_m2_track(data, ofs, 'float3');
			bone.pivot = data.readFloatLE(3);

			// convert coordinate system (wow z-up to webgl y-up)
			this._convert_bone_coords(bone);

			this.bones[i] = bone;
		}

		data.seek(base);
	}

	_convert_bone_coords(bone) {
		const translations = bone.translation.values;
		const rotations = bone.rotation.values;
		const scale = bone.scale.values;
		const pivot = bone.pivot;

		// single-timeline: values is flat array, not per-animation
		if (this.version < M2_VER_WOTLK) {
			for (let j = 0; j < translations.length; j++) {
				const dx = translations[j][0];
				const dy = translations[j][1];
				const dz = translations[j][2];
				translations[j][0] = dx;
				translations[j][2] = dy * -1;
				translations[j][1] = dz;
			}

			for (let j = 0; j < rotations.length; j++) {
				const dx = rotations[j][0];
				const dy = rotations[j][1];
				const dz = rotations[j][2];
				const dw = rotations[j][3];
				rotations[j][0] = dx;
				rotations[j][2] = dy * -1;
				rotations[j][1] = dz;
				rotations[j][3] = dw;
			}

			for (let j = 0; j < scale.length; j++) {
				const dx = scale[j][0];
				const dy = scale[j][1];
				const dz = scale[j][2];
				scale[j][0] = dx;
				scale[j][2] = dy;
				scale[j][1] = dz;
			}
		} else {
			// per-animation timeline
			for (let i = 0; i < translations.length; i++) {
				for (let j = 0; j < translations[i].length; j++) {
					const dx = translations[i][j][0];
					const dy = translations[i][j][1];
					const dz = translations[i][j][2];
					translations[i][j][0] = dx;
					translations[i][j][2] = dy * -1;
					translations[i][j][1] = dz;
				}
			}

			for (let i = 0; i < rotations.length; i++) {
				for (let j = 0; j < rotations[i].length; j++) {
					const dx = rotations[i][j][0];
					const dy = rotations[i][j][1];
					const dz = rotations[i][j][2];
					const dw = rotations[i][j][3];
					rotations[i][j][0] = dx;
					rotations[i][j][2] = dy * -1;
					rotations[i][j][1] = dz;
					rotations[i][j][3] = dw;
				}
			}

			for (let i = 0; i < scale.length; i++) {
				for (let j = 0; j < scale[i].length; j++) {
					const dx = scale[i][j][0];
					const dy = scale[i][j][1];
					const dz = scale[i][j][2];
					scale[i][j][0] = dx;
					scale[i][j][2] = dy;
					scale[i][j][1] = dz;
				}
			}
		}

		// pivot
		const pivotX = pivot[0];
		const pivotY = pivot[1];
		const pivotZ = pivot[2];
		pivot[0] = pivotX;
		pivot[2] = pivotY * -1;
		pivot[1] = pivotZ;
	}

	_parse_vertices(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		const vertices = this.vertices = new Array(count * 3);
		const normals = this.normals = new Array(count * 3);
		const uv = this.uv = new Array(count * 2);
		const uv2 = this.uv2 = new Array(count * 2);
		const boneWeights = this.boneWeights = new Array(count * 4);
		const boneIndices = this.boneIndices = new Array(count * 4);

		for (let i = 0; i < count; i++) {
			// position (convert z-up to y-up)
			vertices[i * 3] = data.readFloatLE();
			vertices[i * 3 + 2] = data.readFloatLE() * -1;
			vertices[i * 3 + 1] = data.readFloatLE();

			// bone weights
			for (let x = 0; x < 4; x++)
				boneWeights[i * 4 + x] = data.readUInt8();

			// bone indices
			for (let x = 0; x < 4; x++)
				boneIndices[i * 4 + x] = data.readUInt8();

			// normals (convert z-up to y-up)
			normals[i * 3] = data.readFloatLE();
			normals[i * 3 + 2] = data.readFloatLE() * -1;
			normals[i * 3 + 1] = data.readFloatLE();

			// uv (flip v)
			uv[i * 2] = data.readFloatLE();
			uv[i * 2 + 1] = (data.readFloatLE() - 1) * -1;

			// uv2 (flip v)
			uv2[i * 2] = data.readFloatLE();
			uv2[i * 2 + 1] = (data.readFloatLE() - 1) * -1;
		}

		data.seek(base);
	}

	_parse_views_inline(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		this.viewCount = count;
		this.skins = new Array(count);

		const base = data.offset;
		data.seek(offset + ofs);

		for (let v = 0; v < count; v++) {
			const skin = {};

			// indices
			const indicesCount = data.readUInt32LE();
			const indicesOfs = data.readUInt32LE();

			// triangles
			const trianglesCount = data.readUInt32LE();
			const trianglesOfs = data.readUInt32LE();

			// properties (bone lookup)
			const propertiesCount = data.readUInt32LE();
			const propertiesOfs = data.readUInt32LE();

			// submeshes
			const subMeshesCount = data.readUInt32LE();
			const subMeshesOfs = data.readUInt32LE();

			// texture units (batches)
			const textureUnitsCount = data.readUInt32LE();
			const textureUnitsOfs = data.readUInt32LE();

			skin.bones = data.readUInt32LE();

			const viewBase = data.offset;

			// read indices
			data.seek(indicesOfs + ofs);
			skin.indices = data.readUInt16LE(indicesCount);

			// read triangles
			data.seek(trianglesOfs + ofs);
			skin.triangles = data.readUInt16LE(trianglesCount);

			// read properties
			data.seek(propertiesOfs + ofs);
			skin.properties = data.readUInt8(propertiesCount);

			// read submeshes
			data.seek(subMeshesOfs + ofs);
			skin.subMeshes = new Array(subMeshesCount);

			for (let i = 0; i < subMeshesCount; i++) {
				skin.subMeshes[i] = {
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
					centerPosition: data.readFloatLE(3)
				};

				// tbc+ added sort center and radius
				if (this.version >= M2_VER_TBC_MIN) {
					skin.subMeshes[i].sortCenterPosition = data.readFloatLE(3);
					skin.subMeshes[i].sortRadius = data.readFloatLE();
				}

				skin.subMeshes[i].triangleStart += skin.subMeshes[i].level << 16;
			}

			// read texture units
			data.seek(textureUnitsOfs + ofs);
			skin.textureUnits = new Array(textureUnitsCount);

			for (let i = 0; i < textureUnitsCount; i++) {
				skin.textureUnits[i] = {
					flags: data.readUInt8(),
					priority: data.readUInt8(),
					shaderID: data.readUInt16LE(),
					skinSectionIndex: data.readUInt16LE(),
					flags2: data.readUInt16LE(),
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

			skin.isLoaded = true;
			this.skins[v] = skin;

			data.seek(viewBase);
		}

		data.seek(base);
	}

	_parse_colors(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.colors = new Array(count);
		for (let i = 0; i < count; i++) {
			this.colors[i] = {
				color: this._read_m2_track(data, ofs, 'float3'),
				alpha: this._read_m2_track(data, ofs, 'int16')
			};
		}

		data.seek(base);
	}

	_parse_textures(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.textures = new Array(count);
		this.textureTypes = new Array(count);

		for (let i = 0; i < count; i++) {
			const textureType = this.textureTypes[i] = data.readUInt32LE();
			const texture = new Texture(data.readUInt32LE());

			const nameLength = data.readUInt32LE();
			const nameOfs = data.readUInt32LE();

			// legacy textures use filename strings (store directly, not via setFileName)
			if (textureType === 0 && nameOfs > 0 && nameLength > 0) {
				const pos = data.offset;
				data.seek(nameOfs + ofs);

				let fileName = data.readString(nameLength);
				fileName = fileName.replace(/\0/g, '');

				if (fileName.length > 0)
					texture.fileName = fileName;

				data.seek(pos);
			}

			this.textures[i] = texture;
		}

		data.seek(base);
	}

	_parse_texture_weights(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.textureWeights = new Array(count);
		for (let i = 0; i < count; i++)
			this.textureWeights[i] = this._read_m2_track(data, ofs, 'int16');

		data.seek(base);
	}

	_parse_texture_transforms(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.textureTransforms = new Array(count);
		for (let i = 0; i < count; i++) {
			this.textureTransforms[i] = {
				translation: this._read_m2_track(data, ofs, 'float3'),
				rotation: this._read_m2_track(data, ofs, 'float4'),
				scaling: this._read_m2_track(data, ofs, 'float3')
			};
		}

		data.seek(base);
	}

	_parse_replaceable_texture_lookup(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.replaceableTextureLookup = data.readInt16LE(count);
		data.seek(base);
	}

	_parse_materials(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.materials = new Array(count);
		for (let i = 0; i < count; i++) {
			this.materials[i] = {
				flags: data.readUInt16LE(),
				blendingMode: data.readUInt16LE()
			};
		}

		data.seek(base);
	}

	_parse_texture_combos(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.textureCombos = data.readUInt16LE(count);
		data.seek(base);
	}

	_parse_transparency_lookup(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.transparencyLookup = data.readUInt16LE(count);
		data.seek(base);
	}

	_parse_texture_transform_lookup(ofs) {
		const data = this.data;
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);
		this.textureTransformsLookup = data.readUInt16LE(count);
		data.seek(base);
	}

	_parse_bounding_box() {
		const data = this.data;

		this.boundingBox = {
			min: data.readFloatLE(3),
			max: data.readFloatLE(3)
		};
		this.boundingSphereRadius = data.readFloatLE();

		this.collisionBox = {
			min: data.readFloatLE(3),
			max: data.readFloatLE(3)
		};
		this.collisionSphereRadius = data.readFloatLE();
	}

	_parse_collision(ofs) {
		const data = this.data;

		const indicesCount = data.readUInt32LE();
		const indicesOfs = data.readUInt32LE();
		const positionsCount = data.readUInt32LE();
		const positionsOfs = data.readUInt32LE();
		const normalsCount = data.readUInt32LE();
		const normalsOfs = data.readUInt32LE();

		const base = data.offset;

		// indices
		data.seek(indicesOfs + ofs);
		this.collisionIndices = data.readUInt16LE(indicesCount);

		// positions (convert z-up to y-up)
		data.seek(positionsOfs + ofs);
		const positions = this.collisionPositions = new Array(positionsCount * 3);
		for (let i = 0; i < positionsCount; i++) {
			positions[i * 3] = data.readFloatLE();
			positions[i * 3 + 2] = data.readFloatLE() * -1;
			positions[i * 3 + 1] = data.readFloatLE();
		}

		// normals (convert z-up to y-up)
		data.seek(normalsOfs + ofs);
		const normals = this.collisionNormals = new Array(normalsCount * 3);
		for (let i = 0; i < normalsCount; i++) {
			normals[i * 3] = data.readFloatLE();
			normals[i * 3 + 2] = data.readFloatLE() * -1;
			normals[i * 3 + 1] = data.readFloatLE();
		}

		data.seek(base);
	}

	_parse_attachments(ofs) {
		const data = this.data;

		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		this.attachments = new Array(count);
		for (let i = 0; i < count; i++) {
			this.attachments[i] = {
				id: data.readUInt32LE(),
				bone: data.readUInt16LE(),
				unknown: data.readUInt16LE(),
				position: data.readFloatLE(3),
				animateAttached: this._read_m2_track(data, ofs, 'uint8')
			};
		}

		data.seek(base);
	}

	// legacy animation block has ranges array for single-timeline
	_read_m2_track(data, ofs, dataType) {
		const interpolation = data.readUInt16LE();
		const globalSeq = data.readInt16LE();

		let ranges = null;
		let timestamps;
		let values;

		if (this.version < M2_VER_WOTLK) {
			// pre-wotlk: single timeline with ranges
			ranges = this._read_m2_array(data, ofs, 'uint32_pair');
			timestamps = this._read_m2_array(data, ofs, 'uint32');
			values = this._read_m2_array(data, ofs, dataType);
		} else {
			// wotlk: per-animation arrays
			timestamps = this._read_m2_array_array(data, ofs, 'uint32');
			values = this._read_m2_array_array(data, ofs, dataType);
		}

		return new M2Track(globalSeq, interpolation, timestamps, values, ranges);
	}

	// read simple array (for single-timeline legacy format)
	_read_m2_array(data, ofs, dataType) {
		const count = data.readUInt32LE();
		const offset = data.readUInt32LE();

		const base = data.offset;
		data.seek(offset + ofs);

		const arr = new Array(count);
		for (let i = 0; i < count; i++)
			arr[i] = this._read_data_type(data, dataType);

		data.seek(base);
		return arr;
	}

	// read array of arrays (for per-animation wotlk format)
	_read_m2_array_array(data, ofs, dataType) {
		const arrCount = data.readUInt32LE();
		const arrOfs = data.readUInt32LE();

		const base = data.offset;
		data.seek(ofs + arrOfs);

		const arr = new Array(arrCount);
		for (let i = 0; i < arrCount; i++) {
			const subArrCount = data.readUInt32LE();
			const subArrOfs = data.readUInt32LE();
			const subBase = data.offset;

			data.seek(ofs + subArrOfs);

			arr[i] = new Array(subArrCount);
			for (let j = 0; j < subArrCount; j++)
				arr[i][j] = this._read_data_type(data, dataType);

			data.seek(subBase);
		}

		data.seek(base);
		return arr;
	}

	_read_data_type(data, dataType) {
		switch (dataType) {
			case 'uint32':
				return data.readUInt32LE();

			case 'uint32_pair':
				return [data.readUInt32LE(), data.readUInt32LE()];

			case 'int16':
				return data.readInt16LE();

			case 'uint8':
				return data.readUInt8();

			case 'float3':
				return data.readFloatLE(3);

			case 'float4':
				return data.readFloatLE(4);

			case 'compquat':
				return data.readInt16LE(4).map(e => (e < 0 ? e + 32768 : e - 32767) / 32767);

			default:
				throw new Error('Unknown data type: ' + dataType);
		}
	}

	async getSkin(index) {
		if (this.version < M2_VER_WOTLK) {
			// pre-wotlk: skins are already loaded inline
			return this.skins[index];
		}

		// wotlk: would need external skin loading (not implemented for legacy)
		throw new Error('External skin loading not implemented for legacy WotLK M2');
	}

	getSkinList() {
		return this.skins;
	}
}

export default M2LegacyLoader;