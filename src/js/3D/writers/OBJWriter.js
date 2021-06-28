/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const constants = require('../../constants');
const generics = require('../../generics');
const FileWriter = require('../../file-writer');

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
		this.meshes.push({ name, triangles, matName });
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
		writer.writeLine('# Exported using wow.export v' + constants.VERSION);
		writer.writeLine('o ' + this.name);

		// Link material library.
		if (this.mtl)
			writer.writeLine('mtllib ' + this.mtl);

		const usedIndices = new Set();
		this.meshes.forEach(mesh => mesh.triangles.forEach(index => usedIndices.add(index)));

		const vertMap = new Map();
		const normalMap = new Map();
		const uvMap = new Map();

		// Write verts.
		const verts = this.verts;
		for (let i = 0, j = 0, u = 0, n = verts.length; i < n; j++, i+= 3) {
			if (usedIndices.has(j)) {
				vertMap.set(j, u++);
				writer.writeLine('v ' + verts[i] + ' ' + verts[i + 1] + ' ' + verts[i + 2]);
			}
		}

		// Write normals.
		const normals = this.normals;
		for (let i = 0, j = 0, u = 0, n = normals.length; i < n; j++, i += 3) {
			if (usedIndices.has(j)) {
				normalMap.set(j, u++);
				writer.writeLine('vn ' + normals[i] + ' ' + normals[i + 1] + ' ' + normals[i + 2]);
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

						writer.writeLine(prefix + ' ' + uv[i] + ' ' + uv[i + 1]);
					}
				}
			}
		}

		// Write meshes.
		for (const mesh of this.meshes) {
			writer.writeLine('g ' + mesh.name);
			writer.writeLine('s 1');

			if (mesh.matName)
				writer.writeLine('usemtl ' + mesh.matName);

			const triangles = mesh.triangles;
			if (hasUV) {
				for (let i = 0, n = triangles.length; i < n; i += 3) {
					const pointA = (vertMap.get(triangles[i]) + 1) + '/' + (uvMap.get(triangles[i]) + 1) + '/' + (normalMap.get(triangles[i]) + 1);
					const pointB = (vertMap.get(triangles[i + 1]) + 1) + '/' + (uvMap.get(triangles[i + 1]) + 1) + '/' + (normalMap.get(triangles[i + 1]) + 1);
					const pointC = (vertMap.get(triangles[i + 2]) + 1) + '/' + (uvMap.get(triangles[i + 2]) + 1) + '/' + (normalMap.get(triangles[i + 2]) + 1);

					writer.writeLine('f ' + pointA + ' ' + pointB + ' ' + pointC);
				}
			} else {
				for (let i = 0, n = triangles.length; i < n; i += 3) {
					const pointA = (vertMap.get(triangles[i]) + 1) + '/' + (normalMap.get(triangles[i]) + 1);
					const pointB = (vertMap.get(triangles[i + 1]) + 1) + '/' + (normalMap.get(triangles[i + 1]) + 1);
					const pointC = (vertMap.get(triangles[i + 2]) + 1) + '/' + (normalMap.get(triangles[i + 2]) + 1);

					writer.writeLine('f ' + pointA + ' ' + pointB + ' ' + pointC);
				}
			}
		}

		await writer.close();
	}
}

module.exports = OBJWriter;