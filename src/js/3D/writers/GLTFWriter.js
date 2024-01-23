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

const GLTF_ARRAY_BUFFER = 0x8892;
const GLTF_ELEMENT_ARRAY_BUFFER = 0x8893;

//const GLTF_BYTE = 0x1400;
const GLTF_UNSIGNED_BYTE = 0x1401;
//const GLTF_SHORT = 0x1402;
const GLTF_UNSIGNED_SHORT = 0x1403;
//const GLTF_UNSIGNED_INT = 0x1405;
const GLTF_FLOAT = 0x1406;

//const GLTF_POINTS = 0x0000;
//const GLTF_LINES = 0x0001;
//const GLTF_LINE_LOOP = 0x0002;
//const GLTF_LINE_STRIP = 0x0003;
const GLTF_TRIANGLES = 0x0004;
//const GLTF_TRIANGLE_STRIP = 0x0005;
//const GLTF_TRIANGLE_FAN = 0x0006;

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
	 * Set the UV array for this writer.
	 * @param {Array} uvs 
	 */
	setUVArray(uvs) {
		this.uvs = uvs;
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
			nodes: [
				{
					name: this.name,
					children: [],
				}
			],
			scenes: [
				{
					name: this.name + 'Scene',
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
				},
				{
					// UVs ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: GLTF_ARRAY_BUFFER
				},
				{
					// Bone joints/indices ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: GLTF_ARRAY_BUFFER
				},
				{
					// Bone weights ARRAY_BUFFER
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
				{
					// UVs (Float)
					name: 'TEXCOORD_0',
					bufferView: 2,
					byteOffset: 0,
					componentType: GLTF_FLOAT,
					count: 0,
					type: 'VEC2'
				},
				{
					// Bone joints/indices (Byte)
					name: 'JOINTS_0',
					bufferView: 3,
					byteOffset: 0,
					componentType: GLTF_UNSIGNED_BYTE,
					count: 0,
					type: 'VEC4'
				},
				{
					// Bone weights (Byte)
					name: 'WEIGHTS_0',
					bufferView: 4,
					byteOffset: 0,
					componentType: GLTF_UNSIGNED_BYTE,
					count: 0,
					normalized: true,
					type: 'VEC4'
				}
			],
			skins: [
				{
					name: this.name + "_Armature",
					joints: [],
					skeleton: 0
				}
			],
			textures: [],
			images: [],
			materials: [],
			meshes: [],
			scene: 0
		};

		const nodes = root.nodes;
		const skin = root.skins[0];

		const bones = this.bones;
		const skeleton = nodes[0];

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

			const node = {
				name: this.name + '_bone_' + i
			};

			bone_lookup_map.set(i, node);

			nodes.push(prefix_node);
			nodes.push(node);

			skin.joints.push(nodeIndex + 1);
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

		// Flip UV on Y axis.
		for (let i = 0, n = this.uvs.length; i < n; i += 2)
			this.uvs[i + 1] = (this.uvs[i + 1] - 1) * -1;

		const binSize = (this.vertices.length * 4) + (this.normals.length * 4) + (this.uvs.length * 4) + this.boneIndices.length + this.boneWeights.length + triangleSize;
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
		writeData(2, this.uvs, 2, GLTF_FLOAT);
		writeData(3, this.boneIndices, 4, GLTF_UNSIGNED_BYTE);
		writeData(4, this.boneWeights, 4, GLTF_UNSIGNED_BYTE);

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
						attributes: {
							POSITION: 0,
							NORMAL: 1,
							TEXCOORD_0: 2,
							JOINTS_0: 3,
							WEIGHTS_0: 4,
						},
						indices: accessorIndex,
						mode: GLTF_TRIANGLES,
						material: materialMap.get(mesh.matName)
					}
				]
			});

			//const nodeIndex = nodes.length;
			//rootChildren.push(nodeIndex);
			nodes.push({ name: `${this.name}_${mesh.name}`, mesh: meshIndex, skin: 0 });
			root.scenes[0].nodes.push(nodes.length - 1);
		}

		await generics.createDirectory(path.dirname(this.out));
		await fsp.writeFile(outGLTF, JSON.stringify(root, null, '\t'), 'utf8');
		await bin.writeToFile(outBIN);
	}
}

module.exports = GLTFWriter;