/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import BufferWrapper from '../../buffer.js';
import generics from '../../generics.js';
import constants from '../../constants.js';



class STLWriter {
	/**
	 * Construct a new STLWriter instance.
	 * @param {string} out Output path to write to.
	 */
	constructor(out) {
		this.out = out;

		this.verts = [];
		this.normals = [];
		this.meshes = [];
		this.name = 'Mesh';

		// track vertex offsets for appending additional models
		this.vertex_offset = 0;
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
	 * Add a mesh to this writer.
	 * @param {string} name
	 * @param {Array} triangles
	 */
	addMesh(name, triangles) {
		this.meshes.push({ name, triangles, vertexOffset: this.vertex_offset });
	}

	/**
	 * Append additional geometry from another model.
	 * @param {Float32Array|Array} verts - vertex array (x,y,z triplets)
	 * @param {Float32Array|Array} normals - normal array (x,y,z triplets)
	 */
	appendGeometry(verts, normals) {
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
	}

	/**
	 * Calculate normal from three vertices using cross product.
	 * @param {number} v1x
	 * @param {number} v1y
	 * @param {number} v1z
	 * @param {number} v2x
	 * @param {number} v2y
	 * @param {number} v2z
	 * @param {number} v3x
	 * @param {number} v3y
	 * @param {number} v3z
	 * @returns {Array}
	 */
	calculate_normal(v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z) {
		// edge vectors
		const ux = v2x - v1x;
		const uy = v2y - v1y;
		const uz = v2z - v1z;

		const vx = v3x - v1x;
		const vy = v3y - v1y;
		const vz = v3z - v1z;

		// cross product
		let nx = uy * vz - uz * vy;
		let ny = uz * vx - ux * vz;
		let nz = ux * vy - uy * vx;

		// normalize
		const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
		if (len > 0) {
			nx /= len;
			ny /= len;
			nz /= len;
		}

		return [nx, ny, nz];
	}

	/**
	 * Write the STL file in binary format.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(this.out.substring(0, this.out.lastIndexOf('/')));

		// count total triangles
		let triangle_count = 0;
		for (const mesh of this.meshes)
			triangle_count += mesh.triangles.length / 3;

		// binary stl: 80 byte header + 4 byte count + 50 bytes per triangle
		const buffer_size = 80 + 4 + (triangle_count * 50);
		const buffer = BufferWrapper.alloc(buffer_size, true);

		// write header (80 bytes)
		const header = 'Exported using wow.export v' + constants.VERSION;
		const header_bytes = new TextEncoder().encode(header);
		buffer.writeBuffer(header_bytes);

		// pad remaining header with zeros
		for (let i = header_bytes.length; i < 80; i++)
			buffer.writeUInt8(0);

		// write triangle count
		buffer.writeUInt32LE(triangle_count);

		const verts = this.verts;
		const normals = this.normals;
		const has_normals = normals.length > 0;

		// write each triangle
		// coordinate transform: wow uses Y-up, stl expects Z-up
		// swap Y and Z components for both vertices and normals
		for (const mesh of this.meshes) {
			const triangles = mesh.triangles;
			const offset = mesh.vertexOffset || 0;

			for (let i = 0, n = triangles.length; i < n; i += 3) {
				const i0 = triangles[i] + offset;
				const i1 = triangles[i + 1] + offset;
				const i2 = triangles[i + 2] + offset;

				// vertex positions (swap y/z for coordinate system conversion)
				const v0_idx = i0 * 3;
				const v1_idx = i1 * 3;
				const v2_idx = i2 * 3;

				const v0x = verts[v0_idx];
				const v0y = verts[v0_idx + 2];
				const v0z = verts[v0_idx + 1];

				const v1x = verts[v1_idx];
				const v1y = verts[v1_idx + 2];
				const v1z = verts[v1_idx + 1];

				const v2x = verts[v2_idx];
				const v2y = verts[v2_idx + 2];
				const v2z = verts[v2_idx + 1];

				// calculate face normal (or use vertex normals averaged)
				let nx, ny, nz;
				if (has_normals) {
					// average vertex normals for face normal (swap y/z)
					const n0x = normals[v0_idx];
					const n0y = normals[v0_idx + 2];
					const n0z = normals[v0_idx + 1];

					const n1x = normals[v1_idx];
					const n1y = normals[v1_idx + 2];
					const n1z = normals[v1_idx + 1];

					const n2x = normals[v2_idx];
					const n2y = normals[v2_idx + 2];
					const n2z = normals[v2_idx + 1];

					nx = (n0x + n1x + n2x) / 3;
					ny = (n0y + n1y + n2y) / 3;
					nz = (n0z + n1z + n2z) / 3;

					// normalize
					const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
					if (len > 0) {
						nx /= len;
						ny /= len;
						nz /= len;
					}
				} else {
					// calculate from vertices (already transformed)
					[nx, ny, nz] = this.calculate_normal(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z);
				}

				// write normal (3 floats = 12 bytes)
				buffer.writeFloatLE(nx);
				buffer.writeFloatLE(ny);
				buffer.writeFloatLE(nz);

				// write vertex 1 (3 floats = 12 bytes)
				buffer.writeFloatLE(v0x);
				buffer.writeFloatLE(v0y);
				buffer.writeFloatLE(v0z);

				// write vertex 2 (3 floats = 12 bytes)
				buffer.writeFloatLE(v1x);
				buffer.writeFloatLE(v1y);
				buffer.writeFloatLE(v1z);

				// write vertex 3 (3 floats = 12 bytes)
				buffer.writeFloatLE(v2x);
				buffer.writeFloatLE(v2y);
				buffer.writeFloatLE(v2z);

				// write attribute byte count (2 bytes, always 0)
				buffer.writeUInt16LE(0);
			}
		}

		await buffer.writeToFile(this.out);
	}
}

export default STLWriter;