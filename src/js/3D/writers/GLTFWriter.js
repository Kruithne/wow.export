/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const fsp = require('fs').promises;
const path = require('path');
const generics = require('../../generics');
const ExportHelper = require('../../casc/export-helper');
const BufferWrapper = require('../../buffer');

// See https://gist.github.com/mhenry07/e31d8c94db91fb823f2eed2fc1b43f15
const GLTF_ARRAY_BUFFER = 0x8892;
const GLTF_ELEMENT_ARRAY_BUFFER = 0x8893;

const GLTF_UNSIGNED_BYTE = 0x1401;
const GLTF_UNSIGNED_SHORT = 0x1403;
const GLTF_FLOAT = 0x1406;

const GLTF_TRIANGLES = 0x0004;

class GLTFWriter {
	/**
	 * Construct a new GLTF writer instance.
	 * @param {string} out 
	 * @param {string} name 
	 */
	constructor(out, name) {
		this.out = out;
		this.name = name;

		this.vertices = [];
		this.normals = [];
		this.uvs = [];
		this.boneWeights = [];
		this.boneIndices = [];
		this.bones = [];
		this.inverseBindMatrices = [];
		
		this.textures = new Map();
		this.meshes = [];
	}

	/**
	 * Set the texture map used for this writer.
	 * @param {Map} textures
	 */
	setTextureMap(textures) {
		this.textures = textures;
	}

	/**
	 * Set the bones array for this writer.
	 * @param {Array} bones 
	 */
	setBonesArray(bones) {
		this.bones = bones;
	}

	/**
	 * Set the vertices array for this writer.
	 * @param {Array} vertices 
	 */
	setVerticesArray(vertices) {
		this.vertices = vertices;
	}

	/**
	 * Set the normals array for this writer.
	 * @param {Array} normals 
	 */
	setNormalArray(normals) {
		this.normals = normals;
	}

	/**
	 * Add a UV array for this writer.
	 * @param {Array} uvs
	 */
	addUVArray(uvs) {
		this.uvs.push(uvs);
	}

	/**
	 * Set the bone weights array for this writer.
	 * @param {Array} boneWeights 
	 */
	setBoneWeightArray(boneWeights) {
		this.boneWeights = boneWeights;
	}

	/**
	 * Set the bone indicies array for this writer.
	 * @param {Array} boneIndices
	 */
	setBoneIndexArray(boneIndices) {
		this.boneIndices = boneIndices;
	}

	/**
	 * Add a mesh to this writer.
	 * @param {string} name 
	 * @param {Array} triangles
	 * @param {string} matName 
	 */
	addMesh(name, triangles, matName) {
		this.meshes.push({ name, triangles, matName });
	}

	/**
	 * Transform Vec3 to Mat4x4
	 * @param {Array} Vector3
	 * @returns {Array} Mat4x4
	 */
	vec3ToMat4x4(v) {
		return [
			1, 0, 0, 0,
			0, 1, 0, 0,
			0, 0, 1, 0,
			v[0] * -1, v[1] * -1, v[2] * -1, 1
		];
	}

	/**
	 * Calculate the minimum/maximum values of an array buffer.
	 * @param {Array} values 
	 * @param {number} stride 
	 * @param {object} target 
	 */
	calculateMinMax(values, stride, target) {
		const min = target.min = Array(stride);
		const max = target.max = Array(stride);

		for (let i = 0; i < values.length; i += stride) {
			for (let ofs = 0; ofs < stride; ofs++) {
				const currentMin = min[ofs];
				const currentMax = max[ofs];
				const value = values[i + ofs];

				if (currentMin === undefined || value < currentMin)
					min[ofs] = value;
				
				if (currentMax === undefined || value > currentMax)
					max[ofs] = value;
			}
		}
	}

	async write(overwrite = true) {
		const outGLTF = ExportHelper.replaceExtension(this.out, '.gltf');
		const outBIN = ExportHelper.replaceExtension(this.out, '.bin');

		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(outGLTF) && await generics.fileExists(outBIN))
			return;

		const manifest = nw.App.manifest;
		const root = {
			asset: {
				version: '2.0',
				generator: util.format('wow.export v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid)
			},
			nodes: [],
			scenes: [
				{
					name: this.name + '_Scene',
					nodes: [0]
				}
			],
			buffers: [
				{
					uri: path.basename(outBIN),
					byteLength: 0
				}
			],
			bufferViews: [
				{
					// Vertices ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: GLTF_ARRAY_BUFFER
				},
				{
					// Normals ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: GLTF_ARRAY_BUFFER
				}
			],
			accessors: [
				{
					// Vertices (Float)
					name: 'POSITION',
					bufferView: 0,
					byteOffset: 0,
					componentType: GLTF_FLOAT,
					count: 0,
					type: 'VEC3'
				},
				{
					// Normals (Float)
					name: 'NORMAL',
					bufferView: 1,
					byteOffset: 0,
					componentType: GLTF_FLOAT,
					count: 0,
					type: 'VEC3'
				},
			],
			textures: [],
			images: [],
			materials: [],
			meshes: [],
			scene: 0
		};

		const primitive_attributes = {
			POSITION: 0,
			NORMAL: 1
		};

		const add_buffered_accessor = (accessor, buffer_target, add_primitive = false) => {
			const buffer_idx = root.bufferViews.push({
				buffer: 0,
				byteLength: 0,
				byteOffset: 0,
				target: buffer_target
			}) - 1;

			if (add_primitive)
				primitive_attributes[accessor.name] = buffer_idx;

			return root.accessors.push(Object.assign(accessor, {
				bufferView: buffer_idx
			})) - 1;
		};

		const nodes = root.nodes;
		const bones = this.bones;

		let combined_bone_length = 0;
		let idx_inv_bind = -1;
		let idx_bone_joints = -1
		let idx_bone_weights = -1;

		if (bones.length > 0) {
			idx_bone_joints = add_buffered_accessor({
				// Bone joints/indices (Byte)
				name: 'JOINTS_0',
				byteOffset: 0,
				componentType: GLTF_UNSIGNED_BYTE,
				count: 0,
				type: 'VEC4'
			}, GLTF_ARRAY_BUFFER, true);

			idx_bone_weights = add_buffered_accessor({
				// Bone weights (Byte)
				name: 'WEIGHTS_0',
				byteOffset: 0,
				componentType: GLTF_UNSIGNED_BYTE,
				count: 0,
				normalized: true,
				type: 'VEC4'
			}, GLTF_ARRAY_BUFFER, true);

			idx_inv_bind = add_buffered_accessor({
				// Inverse matrices (Float)
				name: 'INV_BIND_MATRICES',
				byteOffset: 0,
				componentType: GLTF_FLOAT,
				count: 0,
				type: 'MAT4'
			}, undefined);

			const skin = {
				name: this.name + "_Armature",
				joints: [],
				inverseBindMatrices: idx_inv_bind,
				skeleton: 0
			};

			root.skins = [skin];
			
			const skeleton = {
				name: this.name,
				children: [],
			};
			
			nodes.push(skeleton);

			const bone_lookup_map = new Map();
	
			// Add bone nodes.
			for (let i = 0; i < bones.length; i++) {
				const nodeIndex = nodes.length;
				const bone = bones[i];
	
				let parent_pos = [0, 0, 0];
				if (bone.parentBone > -1) {
					const parent_bone = bones[bone.parentBone];
					parent_pos = parent_bone.pivot;
	
					const parent_node = bone_lookup_map.get(bone.parentBone);
					parent_node.children ? parent_node.children.push(nodeIndex) : parent_node.children = [nodeIndex];
				} else {
					// Parent stray bones to the skeleton root.
					skeleton.children.push(nodeIndex);
				}
	
				const prefix_node = {
					name: 'bone_' + i + '_p',
					translation: bone.pivot.map((v, i) => v - parent_pos[i]),
					children: [nodeIndex + 1]
				};
	
				const node = { name: 'bone_' + i };
	
				bone_lookup_map.set(i, node);
	
				nodes.push(prefix_node);
				nodes.push(node);
	
				this.inverseBindMatrices.push(...this.vec3ToMat4x4(bone.pivot));
	
				skin.joints.push(nodeIndex + 1);
			}

			combined_bone_length = (this.inverseBindMatrices.length * 4) + this.boneIndices.length + this.boneWeights.length;
		}
		
		const materialMap = new Map();
		for (const [fileDataID, texFile] of this.textures) {
			const imageIndex = root.images.length;
			const textureIndex = root.textures.length;
			const materialIndex = root.materials.length;

			root.images.push({ uri: texFile.matPathRelative });
			root.textures.push({ source: imageIndex });
			root.materials.push({
				name: fileDataID.toString(),
				emissiveFactor: [0, 0, 0],
				pbrMetallicRoughness: {
					baseColorTexture: {
						index: textureIndex
					},
					metallicFactor: 0
				}
			});

			materialMap.set(fileDataID, materialIndex);
		}

		let triangleSize = 0;
		for (const mesh of this.meshes)
			triangleSize += mesh.triangles.length * 2;

		let combined_uv_length = 0;
		for (const uv of this.uvs) {
			combined_uv_length += uv.length * 4;

			// Flip UVs on Y axis.
			for (let i = 0; i < uv.length; i += 2)
				uv[i + 1] = (uv[i + 1] - 1) * -1;
		}

		const binSize = (this.vertices.length * 4) + (this.normals.length * 4) + (combined_uv_length) + triangleSize + combined_bone_length;
		const bin = BufferWrapper.alloc(binSize, false);
		root.buffers[0].byteLength = binSize;

		const writeData = (index, arr, stride, componentType) => {
			const view = root.bufferViews[index];
			const accessor = root.accessors[index];

			view.byteOffset = bin.offset;

			if (componentType === GLTF_FLOAT)
				view.byteLength = arr.length * 4;
			else if (componentType === GLTF_UNSIGNED_BYTE)
				view.byteLength = arr.length;

			accessor.count = arr.length / stride;

			this.calculateMinMax(arr, stride, accessor);
			for (const node of arr) {
				if (componentType === GLTF_FLOAT)
					bin.writeFloatLE(node);
				else if (componentType === GLTF_UNSIGNED_BYTE)
					bin.writeUInt8(node);
			}
		};

		writeData(0, this.vertices, 3, GLTF_FLOAT);
		writeData(1, this.normals, 3, GLTF_FLOAT);

		if (bones.length > 0) {
			writeData(idx_bone_joints, this.boneIndices, 4, GLTF_UNSIGNED_BYTE);
			writeData(idx_bone_weights, this.boneWeights, 4, GLTF_UNSIGNED_BYTE);
			writeData(idx_inv_bind, this.inverseBindMatrices, 16, GLTF_FLOAT);
		}

		for (let i = 0, n = this.uvs.length; i < n; i++)  {
			const uv = this.uvs[i];
			const index = root.bufferViews.length;

			const accessor_name = 'TEXCOORD_' + i;
			primitive_attributes[accessor_name] = index;

			root.accessors.push({
				name: accessor_name,
				bufferView: root.bufferViews.length,
				byteOffset: 0,
				componentType: GLTF_FLOAT,
				count: uv.length / 2,
				type: 'VEC2'
			});

			root.bufferViews.push({
				buffer: 0,
				byteLength: 0,
				byteOffset: 0,
				target: GLTF_ARRAY_BUFFER
			});

			writeData(index, uv, 2, GLTF_FLOAT);
		}

		for (const mesh of this.meshes) {
			const bufferViewIndex = root.bufferViews.length;
			const accessorIndex = root.accessors.length;

			// Create ELEMENT_ARRAY_BUFFER for mesh indices.
			root.bufferViews.push({
				buffer: 0,
				byteLength: mesh.triangles.length * 2,
				byteOffset: bin.offset,
				target: GLTF_ELEMENT_ARRAY_BUFFER
			});

			// Create accessor for the mesh indices.
			root.accessors.push({
				bufferView: bufferViewIndex,
				byteOffset: 0,
				componentType: GLTF_UNSIGNED_SHORT,
				count: mesh.triangles.length,
				type: 'SCALAR'
			});

			// Write indices into the binary.
			for (const idx of mesh.triangles)
				bin.writeUInt16LE(idx);

			const meshIndex = root.meshes.length;
			root.meshes.push({
				primitives: [
					{
						attributes: primitive_attributes,
						indices: accessorIndex,
						mode: GLTF_TRIANGLES,
						material: materialMap.get(mesh.matName)
					}
				]
			});

			const node = { name: `${this.name}_${mesh.name}`, mesh: meshIndex, skin: 0 };
			if (bones.length > 0)
				node.skin = 0;

			nodes.push(node);
			root.scenes[0].nodes.push(nodes.length - 1);
		}

		await generics.createDirectory(path.dirname(this.out));
		await fsp.writeFile(outGLTF, JSON.stringify(root, null, '\t'), 'utf8');
		await bin.writeToFile(outBIN);
	}
}

module.exports = GLTFWriter;