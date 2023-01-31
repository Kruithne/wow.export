/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as generics from '../../generics';
import ExportHelper, { ExportTexture } from '../../casc/export-helper';
import BufferWrapper from '../../buffer';
import getBoneName from '../BoneMapper';

type GLTFMesh = {
	name: string;
	triangles: Array<number>;
	matName: string;
}

export default class GLTFWriter {
	out: string;
	name: string;
	vertices: Array<number> = [];
	normals: Array<number> = [];
	uvs: Array<number> = []; // TODO: GLTF writer does not support multiple UVs?
	boneWeights: Array<number> = [];
	boneIndices: Array<number> = [];
	bones: Array<M2Bone> = [];
	meshes: Array<GLTFMesh> = [];
	textures: Map<number, ExportTexture>;

	/**
	 * Construct a new GLTF writer instance.
	 * @param out
	 * @param name
	 */
	constructor(out: string, name: string) {
		this.out = out;
		this.name = name;

		this.boneWeights = [];
		this.boneIndices = [];
		this.bones = [];

		this.textures = new Map();
		this.meshes = [];
	}

	/**
	 * Set the texture map used for this writer.
	 * @param textures
	 */
	setTextureMap(textures: Map<number, ExportTexture>): void {
		this.textures = textures;
	}

	/**
	 * Set the bones array for this writer.
	 * @param bones
	 */
	setBonesArray(bones: Array<M2Bone>): void {
		this.bones = bones;
	}

	/**
	 * Set the vertices array for this writer.
	 * @param vertices
	 */
	setVerticesArray(vertices: Array<number>): void {
		this.vertices = vertices;
	}

	/**
	 * Set the normals array for this writer.
	 * @param normals
	 */
	setNormalArray(normals: Array<number>): void {
		this.normals = normals;
	}

	/**
	 * Set the UV array for this writer.
	 * @param uvs
	 */
	setUVArray(uvs: Array<number>): void {
		this.uvs = uvs;
	}

	/**
	 * Set the bone weights array for this writer.
	 * @param boneWeights
	 */
	setBoneWeightArray(boneWeights: Array<number>): void {
		this.boneWeights = boneWeights;
	}

	/**
	 * Set the bone indicies array for this writer.
	 * @param boneIndices
	 */
	setBoneIndiceArray(boneIndices: Array<number>): void {
		this.boneIndices = boneIndices;
	}

	/**
	 * Add a mesh to this writer.
	 * @param name
	 * @param triangles
	 * @param matName
	 */
	addMesh(name: string, triangles: Array<number>, matName: string): void {
		this.meshes.push({ name: name, triangles: triangles, matName: matName });
	}

	/**
	 * Calculate the minimum/maximum values of an array buffer.
	 * @param values
	 * @param stride
	 * @param target
	 */
	calculateMinMax(values: Array<number>, stride: number, target: object): void {
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
					target: 0x8892
				},
				{
					// Normals ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				},
				{
					// UVs ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				},
				{
					// Bone joints/indices ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				},
				{
					// Bone weights ARRAY_BUFFER
					buffer: 0,
					byteLength: 0,
					byteOffset: 0,
					target: 0x8892
				}
			],
			accessors: [
				{
					// Vertices (Float)
					bufferView: 0,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: 'VEC3'
				},
				{
					// Normals (Float)
					bufferView: 1,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: 'VEC3'
				},
				{
					// UVs (Float)
					bufferView: 2,
					byteOffset: 0,
					componentType: 0x1406,
					count: 0,
					type: 'VEC2'
				},
				{
					// Bone joints/indices (Byte)
					bufferView: 3,
					byteOffset: 0,
					componentType: 0x1401,
					count: 0,
					type: 'VEC4'
				},
				{
					// Bone weights (Byte)
					bufferView: 4,
					byteOffset: 0,
					componentType: 0x1401,
					count: 0,
					type: 'VEC4'
				}
			],
			skins: [
				{
					name: this.name,
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
		//const rootChildren = nodes[0].children;

		//const boneOffset = nodes.length;
		const bones = this.bones;

		// Bone child lookup.
		for (let i = 0, n = bones.length; i < n; i++) {
			const bone = bones[i];
			if (bone.parentBone > -1) {
				const parent = bones[bone.parentBone];
				parent.children ? parent.children.push(i) : parent.children = [i];
			} else {
				// Parent stray bones to the skeleton root.
				//rootChildren.push(i + boneOffset);
			}
		}

		// Add bone nodes.
		for (let i = 0, n = bones.length; i < n; i++) {
			const bone = bones[i];
			skin.joints.push(i);

			const node = {
				name: getBoneName(i),
				children: bone.children
			};

			let parentPos = [0, 0, 0];
			if (node.parentNode > -1)
				parentPos = bones[bone.parentBone].pivot;

			node.translation = bone.pivot.map((v, i) => v -= parentPos[i]);
			nodes.push(node);
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
			this.uvs[i + 1] *= -1;

		const binSize = (this.vertices.length * 4) + (this.normals.length * 4) + (this.uvs.length * 4) + this.boneIndices.length + this.boneWeights.length + triangleSize;
		const bin = BufferWrapper.alloc(binSize, false);
		root.buffers[0].byteLength = binSize;

		const writeData = (index, arr, stride, componentType) => {
			const view = root.bufferViews[index];
			const accessor = root.accessors[index];

			view.byteOffset = bin.offset;

			if (componentType == 0x1406)
				view.byteLength = arr.length * 4;
			else if (componentType == 0x1401)
				view.byteLength = arr.length;

			accessor.count = arr.length / stride;

			this.calculateMinMax(arr, stride, accessor);
			for (const node of arr) {
				if (componentType == 0x1406)
					bin.writeFloat(node);
				else if (componentType == 0x1401)
					bin.writeUInt8(node);
			}
		};

		writeData(0, this.vertices, 3, 0x1406);
		writeData(1, this.normals, 3, 0x1406);
		writeData(2, this.uvs, 2, 0x1406);
		writeData(3, this.boneIndices, 4, 0x1401);
		writeData(4, this.boneWeights, 4, 0x1401);

		for (const mesh of this.meshes) {
			const bufferViewIndex = root.bufferViews.length;
			const accessorIndex = root.accessors.length;

			// Create ELEMENT_ARRAY_BUFFER for mesh indices.
			root.bufferViews.push({
				buffer: 0,
				byteLength: mesh.triangles.length * 2,
				byteOffset: bin.offset,
				target: 0x8893
			});

			// Create accessor for the mesh indices.
			root.accessors.push({
				bufferView: bufferViewIndex,
				byteOffset: 0,
				componentType: 0x1403,
				count: mesh.triangles.length,
				type: 'SCALAR'
			});

			// Write indices into the binary.
			for (const idx of mesh.triangles)
				bin.writeUInt16(idx);

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
						mode: 4,
						material: materialMap.get(mesh.matName)
					}
				]
			});

			//const nodeIndex = nodes.length;
			//rootChildren.push(nodeIndex);
			nodes.push({ name: mesh.name, mesh: meshIndex, skin: 0 });
		}

		await generics.createDirectory(path.dirname(this.out));
		await fs.writeFile(outGLTF, JSON.stringify(root, null, '\t'), 'utf8');
		await bin.writeToFile(outBIN);
	}
}