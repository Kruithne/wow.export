/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import FileWriter from '../../file-writer.js';
import generics from '../../generics.js';



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
		if (verts) {
			if (Array.isArray(this.verts))
				this.verts = [...this.verts, ...verts];
			else
				this.verts = Float32Array.from([...this.verts, ...verts]);
		}

		// append normals
		if (normals) {
			if (Array.isArray(this.normals))
				this.normals = [...this.normals, ...normals];
			else
				this.normals = Float32Array.from([...this.normals, ...normals]);
		}

		// append uvs (match layer count)
		if (uvArrays) {
			for (let i = 0; i < uvArrays.length; i++) {
				if (i >= this.uvs.length)
					this.uvs.push([]);

				const uv = uvArrays[i];
				if (uv) {
					if (Array.isArray(this.uvs[i]))
						this.uvs[i] = [...this.uvs[i], ...uv];
					else
						this.uvs[i] = Float32Array.from([...this.uvs[i], ...uv]);
				}
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

		await generics.createDirectory(this.out.substring(0, this.out.lastIndexOf('/')));
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

						await writer.writeLine(prefix + ' ' + uv[i] + ' ' + uv[i + 1]);
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
}

export default OBJWriter;