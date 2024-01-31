/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const fsp = require('fs').promises;
const path = require('path');
const core = require('../../core');
const generics = require('../../generics');
const ExportHelper = require('../../casc/export-helper');
const BufferWrapper = require('../../buffer');
const BoneMapper = require('../BoneMapper');

// See https://gist.github.com/mhenry07/e31d8c94db91fb823f2eed2fc1b43f15
const GLTF_ARRAY_BUFFER = 0x8892;
const GLTF_ELEMENT_ARRAY_BUFFER = 0x8893;

const GLTF_UNSIGNED_BYTE = 0x1401;
const GLTF_UNSIGNED_SHORT = 0x1403;
const GLTF_UNSIGNED_INT = 0x1405;
const GLTF_FLOAT = 0x1406;

const GLTF_TRIANGLES = 0x0004;

/**
 * Calculate the minimum/maximum values of an array buffer.
 * @param {Array} values 
 * @param {number} stride 
 * @param {object} target 
 */
function calculate_min_max(values, stride, target) {
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

/**
 * Transform Vec3 to Mat4x4
 * @param {Array} Vector3
 * @returns {Array} Mat4x4
 */
function vec3_to_mat4x4(v) {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		v[0] * -1, v[1] * -1, v[2] * -1, 1
	];
}

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
		this.animations = [];
		
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
	 * Set the animations array for this writer.
	 * @param {Array} animations
	 */
	setAnimations(animations) {
		this.animations = animations;
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

	async write(overwrite = true) {
		const outGLTF = ExportHelper.replaceExtension(this.out, '.gltf');
		const outBIN = ExportHelper.replaceExtension(this.out, '.bin');

		const out_dir = path.dirname(outGLTF);
		const use_absolute = core.view.config.enableAbsoluteGLTFPaths;

		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(outGLTF) && await generics.fileExists(outBIN))
			return;

		const manifest = nw.App.manifest;
		const root = {
			asset: {
				version: '2.0',
				generator: util.format('wow.export v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid)
			},
			nodes: [
				{
					name: this.name,
					children: []
				}
			],
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
			meshes: [],
			scene: 0
		};

		const primitive_attributes = {
			POSITION: 0,
			NORMAL: 1
		};

		const add_scene_node = (node) => {
			root.nodes.push(node);
			root.nodes[0].children.push(root.nodes.length - 1);
			return node;
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

			const skeleton = add_scene_node({
				name: this.name,
				children: []
			});

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

				const bone_name = BoneMapper.get_bone_name(bone.boneID, i, bone.boneNameCRC);
				const prefix_node = {
					name: bone_name + '_p',
					translation: bone.pivot.map((v, i) => v - parent_pos[i]),
					children: [nodeIndex + 1]
				};
	
				const node = { name: bone_name };
	
				bone_lookup_map.set(i, node);
	
				nodes.push(prefix_node);
				nodes.push(node);
	
				this.inverseBindMatrices.push(...vec3_to_mat4x4(bone.pivot));
	
				skin.joints.push(nodeIndex + 1);

				// Animations
				// TODO/RESEARCH: How does this interact with prefix bones? We only animate 1 node per bone, but we have 2 nodes per bone.
				// TODO/RESEARCH: How do we calculate animation length? Different animations have different lengths. Do we just support exporting 1 animation (like wow.tools) or do we somehow get the max length for all animations and base everything on that one? Hmm!
				// 		Addendum: briochie suggested separate glTF files for each animation, which might be a good idea.

				// Check interpolation, right now we only support LINEAR (1). The rest (0 - no interpolation, 2 - bezier spline, 3 - hermite spline) will require... well, math.
				if (bone.translation.interpolation == 1) { 
					// Sanity check -- check if the timestamps/values array are the same length as the amount of animations.
					if (bone.translation.timestamps.length != this.animations.length) {
						console.log("timestamps array length does not match the amount of animations, skipping bone " + i);
						continue;
					}

					if (bone.translation.values.length != this.animations.length) {
						console.log("values array length does not match the amount of animations, skipping bone " + i);
						continue;
					}

					// TODO: Add new buffer for this bone if it doesn't already exist. Probably a separate buffer from the mesh one, but we might be able to combine it per animation?
					// TODO: Add new bufferView for this bone.

					// TODO: Add new animation to this glTF file with empty "samplers" and "channels" arrays and applicable name if it doesn't already exist.

					/*
					  "animations": [
						{
						"samplers" : [],
						"channels" : [],
						"name" : "name"
						}
					],
					*/

					// TODO: Add new SCALAR accessor for this bone's translation timestamps as floats.
					// TODO: Add new accessor for this bone's translation values.
					// TODO: Add animation sampler for this bone's translation with input = timestamps accessor, interpolation = "LINEAR", output = values accessor.
					// TODO: Add animation channel for the above sampler with the target node of this bone and target path of "translation" 

					// TODO: Add new SCALAR accessor for this bone's rotation timestamps as floats.
					// TODO: Add new accessor for this bone's rotation values.
					// TODO: Add animation sampler for this bone's rotation with input = timestamps accessor, interpolation = "LINEAR", output = values accessor.
					// TODO: Add animation channel for the above sampler with the target node of this bone and target path of "rotation" 

					// TODO: Add new SCALAR accessor for this bone's scale timestamps as floats.
					// TODO: Add new accessor for this bone's scale values.
					// TODO: Add animation sampler for this bone's scale with input = timestamps accessor, interpolation = "LINEAR", output = values accessor.
					// TODO: Add animation channel for the above sampler with the target node of this bone and target path of "scale" 

					// Example animations JSON 
					/*
					  "animations": [
						{
						"samplers" : [
							{
								"input" : <index of translation timestamps accessor for this bone>,
								"interpolation" : "LINEAR",
								"output" : <index of translation values accessor for this bone>
							},
							{
								"input" : <index of rotation timestamps accessor for this bone>,
								"interpolation" : "LINEAR",
								"output" : <index of rotation values accessor for this bone>
							},
							{
								"input" : <index of scaling timestamps accessor for this bone>,
								"interpolation" : "LINEAR",
								"output" : <index of scaling values accessor for this bone>
							},			
							[... other bone samplers for the same animation ...]				
						],
						"channels" : [ 
							{
								"sampler" : <translation sampler>,
								"target" : {
									"node" : <bone node index>,
									"path" : "translation"
								}
							},
							{
								"sampler" : <rotation sampler>,
								"target" : {
									"node" : <bone node index>,
									"path" : "rotation"
								}
							},
							{
								"sampler" : <scale sampler>,
								"target" : {
									"node" : <bone node index>,
									"path" : "scale"
								}
							},
							[... other bone channels for the same animation ...]	
						],
						"name" : "name"
					},
					[... other animations ...]
					],
					*/

				}
			}
		}

		if (this.textures.size > 0) {
			root.images = [];
			root.textures = [];
			root.materials = [];
		}
		
		const materialMap = new Map();
		for (const [fileDataID, texFile] of this.textures) {
			const imageIndex = root.images.length;
			const textureIndex = root.textures.length;
			const materialIndex = root.materials.length;

			let mat_path = texFile.matPathRelative;
			if (use_absolute)
				mat_path = path.resolve(out_dir, mat_path);

			root.images.push({ uri: mat_path });
			root.textures.push({ source: imageIndex });
			root.materials.push({
				name: path.basename(texFile.matName, path.extname(texFile.matName)),
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

		const mesh_component_meta = Array(this.meshes.length);
		for (let i = 0, n = this.meshes.length; i < n; i++) {
			const mesh = this.meshes[i];

			let component_type = GLTF_UNSIGNED_BYTE;
			let component_sizeof = 1;
			for (const idx of mesh.triangles) {
				if (idx > 255 && component_type === GLTF_UNSIGNED_BYTE) {
					component_type = GLTF_UNSIGNED_SHORT;
					component_sizeof = 2;
				} else if (idx > 65535 && component_type === GLTF_UNSIGNED_SHORT) {
					component_type = GLTF_UNSIGNED_INT;
					component_sizeof = 4;
					break;
				}
			}

			const byte_length = mesh.triangles.length * component_sizeof;

			mesh_component_meta[i] = {
				byte_length,
				component_type
			};
		}

		for (const uv of this.uvs) {
			// Flip UVs on Y axis.
			for (let i = 0; i < uv.length; i += 2)
				uv[i + 1] = (uv[i + 1] - 1) * -1;
		}

		const bins = [];

		const component_sizes = {
			[GLTF_UNSIGNED_BYTE]: 1,
			[GLTF_UNSIGNED_SHORT]: 2,
			[GLTF_UNSIGNED_INT]: 4,
			[GLTF_FLOAT]: 4
		};

		let bin_ofs = 0;
		const writeData = (index, arr, stride, componentType) => {
			const view = root.bufferViews[index];
			const accessor = root.accessors[index];

			const component_size = component_sizes[componentType];
			const misalignment = bin_ofs % component_size;
			const padding = misalignment > 0 ? component_size - misalignment : 0;

			bin_ofs += padding;
			view.byteOffset = bin_ofs;

			const buffer_length = arr.length * component_size;
			view.byteLength = buffer_length;

			bin_ofs += buffer_length;

			const buffer = BufferWrapper.alloc(buffer_length + padding, true);

			if (padding > 0)
				buffer.fill(0, padding);

			accessor.count = arr.length / stride;

			calculate_min_max(arr, stride, accessor);
			for (const node of arr) {
				if (componentType === GLTF_FLOAT)
					buffer.writeFloatLE(node);
				else if (componentType === GLTF_UNSIGNED_BYTE)
					buffer.writeUInt8(node);
			}

			bins.push(buffer);
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

		for (let i = 0, n = this.meshes.length; i < n; i++) {
			const mesh = this.meshes[i];
			const mesh_meta = mesh_component_meta[i];

			const component_type = mesh_meta.component_type;

			const bufferViewIndex = root.bufferViews.length;
			const accessorIndex = root.accessors.length;

			const component_size = component_sizes[component_type];
			const misalignment = bin_ofs % component_size;
			const padding = misalignment > 0 ? component_size - misalignment : 0;

			bin_ofs += padding;

			// Create ELEMENT_ARRAY_BUFFER for mesh indices.
			root.bufferViews.push({
				buffer: 0,
				byteLength: mesh_meta.byte_length,
				byteOffset: bin_ofs,
				target: GLTF_ELEMENT_ARRAY_BUFFER
			});

			bin_ofs += mesh_meta.byte_length;

			const buffer = BufferWrapper.alloc(mesh_meta.byte_length + padding, true);

			if (padding > 0)
				buffer.fill(0, padding);

			// Create accessor for the mesh indices.
			root.accessors.push({
				bufferView: bufferViewIndex,
				byteOffset: 0,
				componentType: component_type,
				count: mesh.triangles.length,
				type: 'SCALAR'
			});

			// Write indices into the binary.
			if (component_type === GLTF_UNSIGNED_BYTE) {
				for (const idx of mesh.triangles)
					buffer.writeUInt8(idx);
			} else if (component_type === GLTF_UNSIGNED_SHORT) {
				for (const idx of mesh.triangles)
					buffer.writeUInt16LE(idx);
			} else if (component_type === GLTF_UNSIGNED_INT) {
				for (const idx of mesh.triangles)
					buffer.writeUInt32LE(idx);
			}

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

			const node = { name: `${this.name}_${mesh.name}`, mesh: meshIndex };
			if (bones.length > 0)
				node.skin = 0;

			add_scene_node(node);
			bins.push(buffer);
		}

		const bin_combined = BufferWrapper.concat(bins);
		root.buffers[0].byteLength = bin_combined.byteLength;

		await generics.createDirectory(path.dirname(this.out));
		await fsp.writeFile(outGLTF, JSON.stringify(root, null, '\t'), 'utf8');
		await bin_combined.writeToFile(outBIN);
	}
}

module.exports = GLTFWriter;