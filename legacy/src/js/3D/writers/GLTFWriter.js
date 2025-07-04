/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
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
const AnimMapper = require('../AnimMapper');
const log = require('../../log');

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
		const animationBufferMap = new Map();

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

			const animation_buffer_lookup_map = new Map();

			if (core.view.config.modelsExportAnimations) {
				for (var animationIndex = 0; animationIndex < this.animations.length; animationIndex++) {
					var requiredBufferSize = 0;
					for (const bone of this.bones) {
						// Timestamps are all floats (uints originally), so 4 bytes each.
						for (let i = 0; i < bone.translation.timestamps.length; i++) {
							if (i == animationIndex && bone.translation.interpolation < 2) {
								requiredBufferSize += bone.translation.timestamps[i].length * 4;
								break;
							}
						}
	
						for (let i = 0; i < bone.rotation.timestamps.length; i++) {
							if (i == animationIndex && bone.rotation.interpolation < 2) {
								requiredBufferSize += bone.rotation.timestamps[i].length * 4;
								break;
							}
						}
	
						for (let i = 0; i < bone.scale.timestamps.length; i++) {
							if (i == animationIndex && bone.scale.interpolation < 2) {
								requiredBufferSize += bone.scale.timestamps[i].length * 4;
								break;
							}
						}
	
						// Vector3 values
						for (let i = 0; i < bone.translation.values.length; i++) {
							if (i == animationIndex && bone.translation.interpolation < 2) {
								requiredBufferSize += bone.translation.values[i].length * 3 * 4;
								break;
							}
						}
	
						for (let i = 0; i < bone.scale.values.length; i++) {
							if (i == animationIndex && bone.scale.interpolation < 2) {
								requiredBufferSize += bone.scale.values[i].length * 3 * 4;
								break;
							}
						}
	
						// Quaternion values
						for (let i = 0; i < bone.rotation.values.length; i++) {
							if (i == animationIndex && bone.rotation.interpolation < 2) {
								requiredBufferSize += bone.rotation.values[i].length * 4 * 4;
								break;
							}
						}
					}
	
					if (requiredBufferSize > 0) {
						animationBufferMap.set(this.animations[animationIndex].id + "-" + this.animations[animationIndex].variationIndex, BufferWrapper.alloc(requiredBufferSize, true));
						
						root.buffers.push({
							uri: path.basename(outBIN, ".bin") + "_anim" + this.animations[animationIndex].id + "-" + this.animations[animationIndex].variationIndex + ".bin",
							byteLength: requiredBufferSize
						});
	
						animation_buffer_lookup_map.set(this.animations[animationIndex].id + "-" + this.animations[animationIndex].variationIndex, root.buffers.length - 1);
					}
				}

				// Animations
				root.animations = [];

				for (const animation of this.animations) {
					root.animations.push(
						{
							"samplers" : [],
							"channels" : [],
							"name" : AnimMapper.get_anim_name(animation.id) + " (ID " + animation.id + " variation " + animation.variationIndex + ")"
						}
					);
				}
			}
			
			// Add bone nodes.
			for (let bi = 0; bi < bones.length; bi++) {
				const nodeIndex = nodes.length;
				const bone = bones[bi];
	
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

				const bone_name = BoneMapper.get_bone_name(bone.boneID, bi, bone.boneNameCRC);
				const prefix_node = {
					name: bone_name + '_p',
					translation: bone.pivot.map((v, i) => v - parent_pos[i]),
					children: [nodeIndex + 1]
				};
	
				const node = { name: bone_name };
	
				bone_lookup_map.set(bi, node);
	
				nodes.push(prefix_node);
				nodes.push(node);
	
				this.inverseBindMatrices.push(...vec3_to_mat4x4(bone.pivot));
	
				skin.joints.push(nodeIndex + 1);
				
				// Skip rest of the bone logic if we're not exporting animations.
				if (!core.view.config.modelsExportAnimations)
					continue;

				// Check interpolation, right now we only support NONE (0, hopefully matches glTF STEP), LINEAR (1). The rest (2 - bezier spline, 3 - hermite spline) will require... well, math.
				if (bone.translation.interpolation < 2) {
					// Sanity check -- check if the timestamps/values array are the same length as the amount of animations.
					if (bone.translation.timestamps.length != 0 && bone.translation.timestamps.length != this.animations.length) {
						log.write("timestamps array length (" + bone.translation.timestamps.length + ") does not match the amount of animations (" + this.animations.length + "), skipping bone " + bi);
						continue;
					}

					if (bone.translation.values.length != 0 && bone.translation.values.length != this.animations.length) {
						log.write("values array length (" + bone.translation.timestamps.length + ") does not match the amount of animations (" + this.animations.length + "), skipping bone " + bi);
						continue;
					}

					// TIMESTAMPS
					for (let i = 0; i < bone.translation.timestamps.length; i++) {
						if (bone.translation.timestamps[i].length == 0)
							continue;
					
						const animName = this.animations[i].id + "-" + this.animations[i].variationIndex;
						const animationBuffer = animationBufferMap.get(animName);

						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.translation.timestamps[i].length * 4,
							byteOffset: animationBuffer.offset,
							name: 'TRANS_TIMESTAMPS_' + bi + '_' + i,
						});

						root.animations[i].samplers.push(
							{
								"input": 0, // Timestamps accessor index is set later
								"interpolation": bone.translation.interpolation == 0 ? "STEP" : "LINEAR",
								"output": 0, // Values accessor index is set later
							}
						);

						// Write out bone timestamps to buffer.
						let timeMin = 9999999;
						let timeMax = 0;

						for (let j = 0; j < bone.translation.timestamps[i].length; j++) {
							// TODO: We need to recalculate these properly.
							const time = bone.translation.timestamps[i][j] / 1000;
							animationBuffer.writeFloatLE(time);

							if (time < timeMin)
								timeMin = time;

							if (time > timeMax)
								timeMax = time;
						}

						// Add new SCALAR accessor for this bone's translation timestamps as floats.
						root.accessors.push({
							name: 'TRANS_TIMESTAMPS_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "SCALAR",
							componentType: 5126, // Float
							min: [timeMin],
							max: [timeMax]
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].input = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.translation.timestamps[i].length;

						// VALUES
						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.translation.values[i].length * 3 * 4,
							byteOffset: animationBuffer.offset,
							name: 'TRANS_VALUES_' + bi + '_' + i,
						});

						// Write out bone values to buffer.
						let min = [9999999, 9999999, 9999999];
						let max = [-9999999, -9999999, -9999999];
						for (let j = 0; j < bone.translation.values[i].length; j++) {
							animationBuffer.writeFloatLE(bone.translation.values[i][j][0]);
							animationBuffer.writeFloatLE(bone.translation.values[i][j][1]);
							animationBuffer.writeFloatLE(bone.translation.values[i][j][2]);

							if (bone.translation.values[i][j][0] < min[0])
								min[0] = bone.translation.values[i][j][0];

							if (bone.translation.values[i][j][1] < min[1])
								min[1] = bone.translation.values[i][j][1];

							if (bone.translation.values[i][j][2] < min[2])
								min[2] = bone.translation.values[i][j][2];

							if (bone.translation.values[i][j][0] > max[0])
								max[0] = bone.translation.values[i][j][0];

							if (bone.translation.values[i][j][1] > max[1])
								max[1] = bone.translation.values[i][j][1];

							if (bone.translation.values[i][j][2] > max[2])
								max[2] = bone.translation.values[i][j][2];
						}

						// Add new VEC3 accessor for this bone's translation values.
						root.accessors.push({
							name: 'TRANS_VALUES_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "VEC3",
							componentType: 5126, // Float
							min: min,
							max: max
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].output = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.translation.values[i].length;

						root.animations[i].channels.push(
							{	
								"sampler": root.animations[i].samplers.length - 1, 
								"target": {
									"node": nodeIndex + 1,
									"path": "translation"
								}
							}
						);
					}
				} else { 
					log.write("Bone " + bi + " has unsupported interpolation type for translation, skipping.");
				}
				
				if (bone.rotation.interpolation < 2) {
					// TODO: We might be able to make this generic?
					// ROTATION
					for (let i = 0; i < bone.rotation.timestamps.length; i++) {
						if (bone.rotation.timestamps[i].length == 0)
							continue;
					
						const animName = this.animations[i].id + "-" + this.animations[i].variationIndex;
						const animationBuffer = animationBufferMap.get(animName);

						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.rotation.timestamps[i].length * 4,
							byteOffset: animationBuffer.offset,
							name: 'ROT_TIMESTAMPS_' + bi + '_' + i,
						});

						root.animations[i].samplers.push(
							{
								"input": 0, // Timestamps accessor index is set later
								"interpolation": bone.rotation.interpolation == 0 ? "STEP" : "LINEAR",
								"output": 0, // Values accessor index is set later
							}
						);

						// Write out bone timestamps to buffer.
						let timeMin = 9999999;
						let timeMax = 0;

						for (let j = 0; j < bone.rotation.timestamps[i].length; j++) {
							// TODO: We need to recalculate these properly.
							const time = bone.rotation.timestamps[i][j] / 1000;
							animationBuffer.writeFloatLE(time);

							if (time < timeMin)
								timeMin = time;

							if (time > timeMax)
								timeMax = time;
						}

						// Add new SCALAR accessor for this bone's rotation timestamps as floats.
						root.accessors.push({
							name: 'ROT_TIMESTAMPS_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "SCALAR",
							componentType: 5126, // Float
							min: [timeMin],
							max: [timeMax]
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].input = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.rotation.timestamps[i].length;

						// VALUES
						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.rotation.values[i].length * 4 * 4,
							byteOffset: animationBuffer.offset,
							name: 'ROT_VALUES_' + bi + '_' + i,
						});

						// Write out bone values to buffer.
						let min = [9999999, 9999999, 9999999, 9999999];
						let max = [-9999999, -9999999, -9999999, -9999999];
						for (let j = 0; j < bone.rotation.values[i].length; j++) {
							animationBuffer.writeFloatLE(bone.rotation.values[i][j][0]);
							animationBuffer.writeFloatLE(bone.rotation.values[i][j][1]);
							animationBuffer.writeFloatLE(bone.rotation.values[i][j][2]);
							animationBuffer.writeFloatLE(bone.rotation.values[i][j][3]);

							if (bone.rotation.values[i][j][0] < min[0])
								min[0] = bone.rotation.values[i][j][0];

							if (bone.rotation.values[i][j][1] < min[1])
								min[1] = bone.rotation.values[i][j][1];

							if (bone.rotation.values[i][j][2] < min[2])
								min[2] = bone.rotation.values[i][j][2];

							if (bone.rotation.values[i][j][3] < min[3])
								min[3] = bone.rotation.values[i][j][3];

							if (bone.rotation.values[i][j][0] > max[0])
								max[0] = bone.rotation.values[i][j][0];

							if (bone.rotation.values[i][j][1] > max[1])
								max[1] = bone.rotation.values[i][j][1];

							if (bone.rotation.values[i][j][2] > max[2])
								max[2] = bone.rotation.values[i][j][2];

							if (bone.rotation.values[i][j][3] > max[3])
								max[3] = bone.rotation.values[i][j][3];
						}

						// Add new VEC3 accessor for this bone's rotation values.
						root.accessors.push({
							name: 'ROT_VALUES_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "VEC4",
							componentType: 5126, // Float
							min: min,
							max: max
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].output = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.rotation.values[i].length;

						root.animations[i].channels.push(
							{	
								"sampler": root.animations[i].samplers.length - 1, 
								"target": {
									"node": nodeIndex + 1,
									"path": "rotation"
								}
							}
						);
					}
				} else { 
					log.write("Bone " + bi + " has unsupported interpolation type for rotation, skipping.");
				}

				if (bone.scale.interpolation < 2) {
					// SCALING
					for (let i = 0; i < bone.scale.timestamps.length; i++) {
						if (bone.scale.timestamps[i].length == 0)
							continue;
					
						const animName = this.animations[i].id + "-" + this.animations[i].variationIndex;
						const animationBuffer = animationBufferMap.get(animName);

						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.scale.timestamps[i].length * 4,
							byteOffset: animationBuffer.offset,
							name: 'SCALE_TIMESTAMPS_' + bi + '_' + i,
						});

						root.animations[i].samplers.push(
							{
								"input": 0, // Timestamps accessor index is set later
								"interpolation": bone.scale.interpolation == 0 ? "STEP" : "LINEAR",
								"output": 0, // Values accessor index is set later
							}
						);

						// Write out bone timestamps to buffer.
						let timeMin = 9999999;
						let timeMax = 0;
						
						for (let j = 0; j < bone.scale.timestamps[i].length; j++) {
							// TODO: We need to recalculate these properly.
							const time = bone.scale.timestamps[i][j] / 1000;
							animationBuffer.writeFloatLE(time);

							if (time < timeMin)
								timeMin = time;

							if (time > timeMax)
								timeMax = time;
						}

						// Add new SCALAR accessor for this bone's scale timestamps as floats.
						root.accessors.push({
							name: 'SCALE_TIMESTAMPS_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "SCALAR",
							componentType: 5126, // Float
							min: [timeMin],
							max: [timeMax]
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].input = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.scale.timestamps[i].length;

						// VALUES
						// Add new bufferView for bone timestamps.
						root.bufferViews.push({
							buffer: animation_buffer_lookup_map.get(this.animations[i].id + "-" + this.animations[i].variationIndex),
							byteLength: bone.scale.values[i].length * 3 * 4,
							byteOffset: animationBuffer.offset,
							name: 'SCALE_VALUES_' + bi + '_' + i,
						});

						// Write out bone values to buffer.
						let min = [9999999, 9999999, 9999999];
						let max = [-9999999, -9999999, -9999999];
						for (let j = 0; j < bone.scale.values[i].length; j++) {
							animationBuffer.writeFloatLE(bone.scale.values[i][j][0]);
							animationBuffer.writeFloatLE(bone.scale.values[i][j][1]);
							animationBuffer.writeFloatLE(bone.scale.values[i][j][2]);

							if (bone.scale.values[i][j][0] < min[0])
								min[0] = bone.scale.values[i][j][0];

							if (bone.scale.values[i][j][1] < min[1])
								min[1] = bone.scale.values[i][j][1];

							if (bone.scale.values[i][j][2] < min[2])
								min[2] = bone.scale.values[i][j][2];

							if (bone.scale.values[i][j][0] > max[0])
								max[0] = bone.scale.values[i][j][0];

							if (bone.scale.values[i][j][1] > max[1])
								max[1] = bone.scale.values[i][j][1];

							if (bone.scale.values[i][j][2] > max[2])
								max[2] = bone.scale.values[i][j][2];
						}

						// Add new VEC3 accessor for this bone's scale values.
						root.accessors.push({
							name: 'SCALE_VALUES_' + bi + '_' + i,
							bufferView: root.bufferViews.length - 1,
							byteOffset: 0,
							type: "VEC3",
							componentType: 5126, // Float
							min: min,
							max: max
						});

						root.animations[i].samplers[root.animations[i].samplers.length - 1].output = root.accessors.length - 1;

						root.accessors[root.accessors.length - 1].count = bone.scale.values[i].length;

						root.animations[i].channels.push(
							{	
								"sampler": root.animations[i].samplers.length - 1, 
								"target": {
									"node": nodeIndex + 1,
									"path": "scale"
								}
							}
						);
					}
				} else { 
					log.write("Bone " + bi + " has unsupported interpolation type for scale, skipping.");
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

		// Write out animation buffers
		for (const [animationName, animationBuffer] of animationBufferMap) {
			const animationPath = path.join(out_dir, path.basename(outBIN, ".bin") + "_anim" + animationName + ".bin");
			await animationBuffer.writeToFile(animationPath);
		}
	}
}

module.exports = GLTFWriter;