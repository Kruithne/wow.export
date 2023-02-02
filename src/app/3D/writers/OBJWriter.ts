/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import { fileExists, createDirectory } from '../../generics';
import Constants from '../../constants';
import FileWriter from '../../file-writer';

type OBJMesh = {
	name: string;
	triangles: Array<number>;
	matName?: string;
}

export default class OBJWriter {
	out: string;
	name: string;
	verts: Array<number> = [];
	normals: Array<number> = [];
	uvs: Array<Array<number>> = [];
	meshes: Array<OBJMesh> = [];
	mtl: string;

	/**
	 * Construct a new OBJWriter instance.
	 * @param {string} out Output path to write to.
	 */
	constructor(out: string) {
		this.out = out;

		this.name = 'Mesh';
	}

	/**
	 * Set the name of the material library.
	 * @param name
	 */
	setMaterialLibrary(name: string): void {
		this.mtl = name;
	}

	/**
	 * Set the name of this model.
	 * @param name
	 */
	setName(name: string): void {
		this.name = name;
	}

	/**
	 * Set the vertex array for this writer.
	 * @param verts
	 */
	setVertArray(verts: Array<number>): void {
		this.verts = verts;
	}

	/**
	 * Set the normals array for this writer.
	 * @param normals
	 */
	setNormalArray(normals: Array<number>): void {
		this.normals = normals;
	}

	/**
	 * Add a UV array for this writer.
	 * @param uv
	 */
	addUVArray(uv: Array<number>): void {
		this.uvs.push(uv);
	}

	/**
	 * Add a mesh to this writer.
	 * @param name
	 * @param triangles
	 * @param matName
	 */
	addMesh(name: string, triangles: Array<number>, matName: string | undefined): void {
		this.meshes.push({ name: name, triangles: triangles, matName: matName });
	}

	/**
	 * Write the OBJ file (and associated MTLs).
	 * @param overwrite
	 */
	async write(overwrite = true): Promise<void> {
		// If overwriting is disabled, check file existence.
		if (!overwrite && await fileExists(this.out))
			return;

		await createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		// Write header.
		writer.writeLine('# Exported using wow.export v' + Constants.VERSION);
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
		for (let i = 0, j = 0, u = 0, n = verts.length; i < n; j++, i += 3) {
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

			for (let i = 0, n = triangles.length; i < n; i += 3) {
				const pointA = (vertMap.get(triangles[i]) + 1) + '/' + (hasUV ? uvMap.get(triangles[i]) + 1 : '') + '/' + (normalMap.get(triangles[i]) + 1);
				const pointB = (vertMap.get(triangles[i + 1]) + 1) + '/' + (hasUV ? uvMap.get(triangles[i + 1]) + 1 : '') + '/' + (normalMap.get(triangles[i + 1]) + 1);
				const pointC = (vertMap.get(triangles[i + 2]) + 1) + '/' + (hasUV ? uvMap.get(triangles[i + 2]) + 1 : '') + '/' + (normalMap.get(triangles[i + 2]) + 1);

				writer.writeLine('f ' + pointA + ' ' + pointB + ' ' + pointC);
			}
		}

		await writer.close();
	}
}