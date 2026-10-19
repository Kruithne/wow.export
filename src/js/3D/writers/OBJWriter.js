/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const constants = require('../../constants');
const generics = require('../../generics');
const FileWriter = require('../../file-writer');

/**
 * Concatenate two numeric sequences into a single Float32Array, allocating the
 * result once and copying in place. Avoids the [...a, ...b] spread that builds a
 * temporary JS array of every element before rebuilding a typed array - a triple
 * copy that exhausts the heap on large (e.g. raid-sized) geometry.
 * @param {Float32Array|Array} a
 * @param {Float32Array|Array} b
 * @returns {Float32Array}
 */
function concatFloats(a, b) {
	const out = new Float32Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

class OBJWriter {
	/**
	 * Construct a new OBJWriter instance.
	 * @param {string} out Output path to write to.
	 */
	constructor(out) {
		this.out = out;

		this.verts = [];
		this.normals = [];
		this.uvs = [];
		this.colors = null;
		this.flip_uvs = false;

		this.meshes = [];
		this.name = 'Mesh';

		// track vertex offsets for appending additional models
		this.vertex_offset = 0;
	}
	
	/**
	 * Set the name of the material library.
	 * @param {string} name 
	 */
	setMaterialLibrary(name) {
		this.mtl = name;
	}

	/**
	 * Set the name of this model.
	 * @param {string} name 
	 */
	setName(name) {
		this.name = name;
	}

	/**
	 * Set the vertex array for this writer.
	 * @param {Array} verts 
	 */
	setVertArray(verts) {
		this.verts = verts;
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
	 * @param {Array} uv 
	 */
	addUVArray(uv) {
		this.uvs.push(uv);
	}

	/**
	 * Set the vertex color array (RGBA floats, 4 per vertex).
	 * @param {Array} colors
	 */
	setColorArray(colors) {
		this.colors = colors;
	}

	/**
	 * Add a mesh to this writer.
	 * @param {string} name
	 * @param {Array} triangles
	 * @param {string} matName
	 */
	addMesh(name, triangles, matName) {
		this.meshes.push({ name, triangles, matName, vertexOffset: this.vertex_offset });
	}

	/**
	 * Append additional geometry from another model.
	 * Call this after setting base model data and adding its meshes.
	 * @param {Float32Array|Array} verts - vertex array (x,y,z triplets)
	 * @param {Float32Array|Array} normals - normal array (x,y,z triplets)
	 * @param {Array<Float32Array|Array>} uvArrays - array of UV arrays
	 */
	appendGeometry(verts, normals, uvArrays) {
		// calculate current vertex count before appending
		const current_vertex_count = this.verts.length / 3;
		this.vertex_offset = current_vertex_count;

		// append vertices
		if (verts)
			this.verts = concatFloats(this.verts, verts);

		// append normals
		if (normals)
			this.normals = concatFloats(this.normals, normals);

		// append uvs (match layer count)
		if (uvArrays) {
			for (let i = 0; i < uvArrays.length; i++) {
				if (i >= this.uvs.length)
					this.uvs.push([]);

				const uv = uvArrays[i];
				if (uv)
					this.uvs[i] = concatFloats(this.uvs[i], uv);
			}
		}
	}

	/**
	 * Write the OBJ file (and associated MTLs).
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		// Write header.
		await writer.writeLine('# Exported using wow.export v' + constants.VERSION);
		await writer.writeLine('o ' + this.name);

		// Link material library.
		if (this.mtl)
			await writer.writeLine('mtllib ' + this.mtl);

		// collect used indices (accounting for vertex offsets from appended geometry)
		const usedIndices = new Set();
		this.meshes.forEach(mesh => {
			const offset = mesh.vertexOffset || 0;
			mesh.triangles.forEach(index => usedIndices.add(index + offset));
		});

		const vertMap = new Map();
		const normalMap = new Map();
		const uvMap = new Map();

		// Write verts.
		const verts = this.verts;
		for (let i = 0, j = 0, u = 0, n = verts.length; i < n; j++, i+= 3) {
			if (usedIndices.has(j)) {
				vertMap.set(j, u++);
				await writer.writeLine('v ' + verts[i] + ' ' + verts[i + 1] + ' ' + verts[i + 2]);
			}
		}

		// Write normals.
		const normals = this.normals;
		for (let i = 0, j = 0, u = 0, n = normals.length; i < n; j++, i += 3) {
			if (usedIndices.has(j)) {
				normalMap.set(j, u++);
				await writer.writeLine('vn ' + normals[i] + ' ' + normals[i + 1] + ' ' + normals[i + 2]);
			}
		}

		// Write vertex colors (non-standard, used by wow.export Blender addon).
		if (this.colors) {
			const colors = this.colors;
			for (let i = 0, j = 0, n = colors.length; i < n; j++, i += 4) {
				if (usedIndices.has(j))
					await writer.writeLine('vc ' + colors[i] + ' ' + colors[i + 1] + ' ' + colors[i + 2] + ' ' + colors[i + 3]);
			}
		}

		// Write UVs
		const layerCount = this.uvs.length;
		const hasUV = layerCount > 0;
		if (hasUV) {
			for (let uvIndex = 0; uvIndex < layerCount; uvIndex++) {
				const uv = this.uvs[uvIndex];

				let prefix = 'vt';

				// Use non-standard properties (vt2, vt3, etc) for additional UV layers.
				if (uvIndex > 0)
					prefix += (uvIndex + 1);

				for (let i = 0, j = 0, u = 0, n = uv.length; i < n; j++, i += 2) {
					if (usedIndices.has(j)) {
						// Build the index reference using just the first layer
						// since it will be identical for all other layers.
						if (uvIndex === 0)
							uvMap.set(j, u++);

						const v = this.flip_uvs ? (1 - uv[i + 1]) : uv[i + 1];
						await writer.writeLine(prefix + ' ' + uv[i] + ' ' + v);
					}
				}
			}
		}

		// Write meshes.
		for (const mesh of this.meshes) {
			await writer.writeLine('g ' + mesh.name);
			await writer.writeLine('s 1');

			if (mesh.matName)
				await writer.writeLine('usemtl ' + mesh.matName);

			const triangles = mesh.triangles;
			const offset = mesh.vertexOffset || 0;

			for (let i = 0, n = triangles.length; i < n; i += 3) {
				const idxA = triangles[i] + offset;
				const idxB = triangles[i + 1] + offset;
				const idxC = triangles[i + 2] + offset;

				const pointA = (vertMap.get(idxA) + 1) + '/' + (hasUV ? uvMap.get(idxA) + 1 : '') + '/' + (normalMap.get(idxA) + 1);
				const pointB = (vertMap.get(idxB) + 1) + '/' + (hasUV ? uvMap.get(idxB) + 1 : '') + '/' + (normalMap.get(idxB) + 1);
				const pointC = (vertMap.get(idxC) + 1) + '/' + (hasUV ? uvMap.get(idxC) + 1 : '') + '/' + (normalMap.get(idxC) + 1);

				await writer.writeLine('f ' + pointA + ' ' + pointB + ' ' + pointC);
			}
		}

		writer.close();
	}

	/**
	 * Write the OBJ file one group at a time, never holding the whole model in
	 * memory at once. Each group carries its own vertices/normals/uvs/colours and
	 * its own meshes (whose triangle indices are group-local, i.e. zero-based
	 * within that group's vertex block). This is the memory-safe path for very
	 * large models (e.g. raid WMOs of several million vertices) where building a
	 * single merged buffer plus every retained index array exhausts the V8 heap.
	 *
	 * Output is equivalent to write(): each group emits its used verts, normals
	 * and uvs, remapped to a compact local numbering, followed by its faces.
	 * Vertex colours are collected during the pass and written after the last
	 * group, one line per emitted vertex. Vertex references in 'f' lines are
	 * global 1-based indices, so a running offset is carried across groups.
	 * Groups are independent (WMO groups never share vertices), so no
	 * cross-group dedup is needed or lost.
	 *
	 * @param {Iterable|AsyncIterable} groups - yields { verts, normals, uvs,
	 *   colors, meshes, flipUVs } where meshes is [{ name, triangles, matName }]
	 *   with triangles zero-based within this group's verts.
	 * @param {boolean} overwrite
	 */
	async writeStreamingGroups(groups, overwrite = true) {
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		// Vertex colours are buffered and written after all groups. The Blender
		// addon pairs vc lines with vertices purely by order, so a group without
		// colours in the middle of the stream would silently shift every later
		// colour onto the wrong vertex. Buffering lets those groups be
		// zero-filled once it is known that any group carries colours, matching
		// the monolithic writer, at a bounded cost of 16 bytes per emitted
		// vertex for the groups that have them.
		const colorBlocks = [];
		let anyColors = false;

		try {
			await writer.writeLine('# Exported using wow.export v' + constants.VERSION);
			await writer.writeLine('o ' + this.name);

			if (this.mtl)
				await writer.writeLine('mtllib ' + this.mtl);

			// Running counts of already-emitted verts / normals / uvs / colours so
			// each group's face indices resolve to the correct global 1-based value.
			let vertBase = 0;
			let normalBase = 0;
			let uvBase = 0;

			for await (const group of groups) {
				const verts = group.verts;
				const normals = group.normals;
				const uvLayers = group.uvs ?? [];
				const colors = group.colors ?? null;
				const meshes = group.meshes ?? [];
				const flipUVs = group.flipUVs ?? this.flip_uvs;

				const layerCount = uvLayers.length;
				const hasUV = layerCount > 0;

				// Determine which of this group's vertices are actually referenced
				// by a face, mirroring write()'s culling so output stays identical.
				const usedIndices = new Set();
				for (const mesh of meshes) {
					const tris = mesh.triangles;
					for (let i = 0, n = tris.length; i < n; i++)
						usedIndices.add(tris[i]);
				}

				// Local (group) index -> compacted position within the emitted block.
				const vertMap = new Map();
				const normalMap = new Map();
				const uvMap = new Map();

				// Verts.
				for (let i = 0, j = 0, u = 0, n = verts.length; i < n; j++, i += 3) {
					if (usedIndices.has(j)) {
						vertMap.set(j, u++);
						await writer.writeLine('v ' + verts[i] + ' ' + verts[i + 1] + ' ' + verts[i + 2]);
					}
				}

				// Normals.
				for (let i = 0, j = 0, u = 0, n = normals.length; i < n; j++, i += 3) {
					if (usedIndices.has(j)) {
						normalMap.set(j, u++);
						await writer.writeLine('vn ' + normals[i] + ' ' + normals[i + 1] + ' ' + normals[i + 2]);
					}
				}

				// Vertex colours are deferred; see colorBlocks above.
				if (colors) {
					const block = new Float32Array(vertMap.size * 4);
					let u = 0;
					for (let i = 0, j = 0, n = colors.length; i < n; j++, i += 4) {
						if (usedIndices.has(j)) {
							const di = u * 4;
							block[di] = colors[i];
							block[di + 1] = colors[i + 1];
							block[di + 2] = colors[i + 2];
							block[di + 3] = colors[i + 3];
							u++;
						}
					}

					colorBlocks.push(block);
					anyColors = true;
				} else {
					colorBlocks.push(vertMap.size);
				}

				// UVs (all layers; index map built from the first layer only).
				if (hasUV) {
					for (let uvIndex = 0; uvIndex < layerCount; uvIndex++) {
						const uv = uvLayers[uvIndex];
						let prefix = 'vt';
						if (uvIndex > 0)
							prefix += (uvIndex + 1);

						for (let i = 0, j = 0, u = 0, n = uv.length; i < n; j++, i += 2) {
							if (usedIndices.has(j)) {
								if (uvIndex === 0)
									uvMap.set(j, u++);

								const v = flipUVs ? (1 - uv[i + 1]) : uv[i + 1];
								await writer.writeLine(prefix + ' ' + uv[i] + ' ' + v);
							}
						}
					}
				}

				// Faces, using global 1-based indices (local compacted + running base).
				for (const mesh of meshes) {
					await writer.writeLine('g ' + mesh.name);
					await writer.writeLine('s 1');

					if (mesh.matName)
						await writer.writeLine('usemtl ' + mesh.matName);

					const tris = mesh.triangles;
					for (let i = 0, n = tris.length; i < n; i += 3) {
						const a = tris[i], b = tris[i + 1], c = tris[i + 2];

						const va = vertBase + vertMap.get(a) + 1;
						const vb = vertBase + vertMap.get(b) + 1;
						const vc = vertBase + vertMap.get(c) + 1;

						const na = normalBase + normalMap.get(a) + 1;
						const nb = normalBase + normalMap.get(b) + 1;
						const nc = normalBase + normalMap.get(c) + 1;

						const ua = hasUV ? uvBase + uvMap.get(a) + 1 : '';
						const ub = hasUV ? uvBase + uvMap.get(b) + 1 : '';
						const uc = hasUV ? uvBase + uvMap.get(c) + 1 : '';

						await writer.writeLine('f ' + va + '/' + ua + '/' + na + ' ' + vb + '/' + ub + '/' + nb + ' ' + vc + '/' + uc + '/' + nc);
					}
				}

				// Advance the global bases by the number of unique verts we emitted
				// for this group (vertMap/normalMap/uvMap all share usedIndices size).
				vertBase += vertMap.size;
				normalBase += normalMap.size;
				uvBase += uvMap.size;
			}

			// Emit the buffered vertex colours, zero-filling groups that had
			// none, so vc count and order always line up with the vertices.
			if (anyColors) {
				for (const block of colorBlocks) {
					if (typeof block === 'number') {
						for (let i = 0; i < block; i++)
							await writer.writeLine('vc 0 0 0 0');
					} else {
						for (let i = 0, n = block.length; i < n; i += 4)
							await writer.writeLine('vc ' + block[i] + ' ' + block[i + 1] + ' ' + block[i + 2] + ' ' + block[i + 3]);
					}
				}
			}
		} finally {
			// A failure mid-stream must not leak the file handle; without this
			// an exception leaves a partial .obj open and looking complete.
			writer.close();
		}
	}
}

module.exports = OBJWriter;