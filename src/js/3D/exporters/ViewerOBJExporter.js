/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const core = require('../../core');
const log = require('../../log');
const path = require('path');
const generics = require('../../generics');

const OBJWriter = require('../writers/OBJWriter');
const MTLWriter = require('../writers/MTLWriter');
const BufferWrapper = require('../../buffer');
const ExportHelper = require('../../casc/export-helper');
const GeosetMapper = require('../GeosetMapper');

/**
 * bake skinned mesh vertices/normals to world space using current skeleton pose
 * @param {THREE.SkinnedMesh} skinned_mesh
 * @returns {{ positions: Float32Array, normals: Float32Array }}
 */
function bake_skinned_mesh(skinned_mesh) {
	const geometry = skinned_mesh.geometry;
	const position_attr = geometry.getAttribute('position');
	const normal_attr = geometry.getAttribute('normal');
	const skin_index_attr = geometry.getAttribute('skinIndex');
	const skin_weight_attr = geometry.getAttribute('skinWeight');

	const skeleton = skinned_mesh.skeleton;
	skeleton.update();

	const vertex_count = position_attr.count;
	const baked_positions = new Float32Array(vertex_count * 3);
	const baked_normals = new Float32Array(vertex_count * 3);

	const vertex = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const skinned_vertex = new THREE.Vector3();
	const skinned_normal = new THREE.Vector3();
	const temp_vertex = new THREE.Vector3();
	const temp_normal = new THREE.Vector3();
	const bone_matrix = new THREE.Matrix4();
	const normal_matrix = new THREE.Matrix3();

	for (let i = 0; i < vertex_count; i++) {
		vertex.fromBufferAttribute(position_attr, i);
		normal.fromBufferAttribute(normal_attr, i);

		skinned_vertex.set(0, 0, 0);
		skinned_normal.set(0, 0, 0);

		for (let j = 0; j < 4; j++) {
			const bone_index = skin_index_attr.getComponent(i, j);
			const weight = skin_weight_attr.getComponent(i, j);

			if (weight > 0 && bone_index < skeleton.bones.length) {
				bone_matrix.multiplyMatrices(
					skeleton.bones[bone_index].matrixWorld,
					skeleton.boneInverses[bone_index]
				);

				temp_vertex.copy(vertex).applyMatrix4(bone_matrix);
				skinned_vertex.addScaledVector(temp_vertex, weight);

				normal_matrix.setFromMatrix4(bone_matrix);
				temp_normal.copy(normal).applyMatrix3(normal_matrix).normalize();
				skinned_normal.addScaledVector(temp_normal, weight);
			}
		}

		skinned_normal.normalize();

		baked_positions.set([skinned_vertex.x, skinned_vertex.y, skinned_vertex.z], i * 3);
		baked_normals.set([skinned_normal.x, skinned_normal.y, skinned_normal.z], i * 3);
	}

	return { positions: baked_positions, normals: baked_normals };
}

/**
 * extract vertex data from a regular mesh
 * @param {THREE.Mesh} mesh
 * @returns {{ positions: Float32Array, normals: Float32Array }}
 */
function extract_mesh_vertices(mesh) {
	const geometry = mesh.geometry;
	const position_attr = geometry.getAttribute('position');
	const normal_attr = geometry.getAttribute('normal');

	const vertex_count = position_attr.count;
	const positions = new Float32Array(vertex_count * 3);
	const normals = new Float32Array(vertex_count * 3);

	const world_matrix = mesh.matrixWorld;
	const normal_matrix = new THREE.Matrix3().getNormalMatrix(world_matrix);
	const vertex = new THREE.Vector3();
	const normal = new THREE.Vector3();

	for (let i = 0; i < vertex_count; i++) {
		vertex.fromBufferAttribute(position_attr, i);
		vertex.applyMatrix4(world_matrix);
		positions.set([vertex.x, vertex.y, vertex.z], i * 3);

		normal.fromBufferAttribute(normal_attr, i);
		normal.applyMatrix3(normal_matrix).normalize();
		normals.set([normal.x, normal.y, normal.z], i * 3);
	}

	return { positions, normals };
}

class ViewerOBJExporter {
	/**
	 * @param {M2Renderer} renderer - the M2Renderer instance
	 * @param {Map} chr_materials - map of texture type to CharMaterialRenderer
	 * @param {Array} geoset_array - geoset visibility array
	 */
	constructor(renderer, chr_materials, geoset_array) {
		this.renderer = renderer;
		this.meshGroup = renderer.meshGroup;
		this.m2 = renderer.m2;
		this.chrMaterials = chr_materials;
		this.geosetArray = geoset_array;
	}

	/**
	 * export the viewer state to OBJ
	 * @param {string} out - output path
	 * @param {ExportHelper} helper
	 */
	async export(out, helper) {
		const config = core.view.config;
		const out_dir = path.dirname(out);

		// skip if file exists and overwrite disabled
		if (!config.overwriteFiles && await generics.fileExists(out)) {
			log.write('Skipping OBJ export of %s (already exists, overwrite disabled)', out);
			return;
		}

		const model_name = path.basename(out, '.obj');
		log.write('Exporting character viewer to OBJ: %s', out);

		const obj = new OBJWriter(out);
		const mtl = new MTLWriter(ExportHelper.replaceExtension(out, '.mtl'));

		obj.setName(model_name);

		// collect all meshes from meshGroup children (not traverse - avoid bones)
		const all_meshes = this.meshGroup.children.filter(
			child => child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh
		);

		if (all_meshes.length === 0) {
			log.write('No meshes to export');
			return;
		}

		// all submeshes share the same vertex buffer - bake from first mesh
		const first_mesh = all_meshes[0];
		const geometry = first_mesh.geometry;

		let positions, normals;
		if (first_mesh instanceof THREE.SkinnedMesh && first_mesh.skeleton) {
			const baked = bake_skinned_mesh(first_mesh);
			positions = baked.positions;
			normals = baked.normals;
		} else {
			const extracted = extract_mesh_vertices(first_mesh);
			positions = extracted.positions;
			normals = extracted.normals;
		}

		obj.setVertArray(positions);
		obj.setNormalArray(normals);

		// uvs
		const uv_attr = geometry.getAttribute('uv');
		if (uv_attr) {
			const uvs = new Float32Array(uv_attr.count * 2);
			for (let i = 0; i < uv_attr.count; i++) {
				uvs[i * 2] = uv_attr.getX(i);
				uvs[i * 2 + 1] = uv_attr.getY(i);
			}
			obj.addUVArray(uvs);
		}

		// export custom textures from CharMaterialRenderer
		const texture_map = new Map();
		const use_posix = config.pathFormat === 'posix';

		for (const [texture_type, chr_material] of this.chrMaterials) {
			if (helper.isCancelled())
				return;

			try {
				const data_uri = chr_material.getURI();
				const tex_file = 'texture_' + texture_type + '.png';
				const tex_path = path.join(out_dir, tex_file);
				const mat_name = 'mat_texture_' + texture_type;

				const data = BufferWrapper.fromBase64(data_uri.replace(/^data[^,]+,/, ''));

				if (config.overwriteFiles || !await generics.fileExists(tex_path)) {
					log.write('Exporting character texture %d -> %s', texture_type, tex_path);
					await data.writeToFile(tex_path);
				}

				let tex_file_ref = tex_file;
				if (use_posix)
					tex_file_ref = ExportHelper.win32ToPosix(tex_file);

				mtl.addMaterial(mat_name, tex_file_ref);
				texture_map.set(texture_type, mat_name);
			} catch (e) {
				log.write('Failed to export character texture %d: %s', texture_type, e.message);
			}
		}

		// default material name for fallback
		const default_mat_name = texture_map.size > 0 ? texture_map.values().next().value : null;

		// each mesh in meshGroup corresponds to a geoset
		// each mesh has geometry.groups defining the triangle range
		for (let i = 0; i < all_meshes.length; i++) {
			if (helper.isCancelled())
				return;

			// check geoset visibility from the geoset array
			if (this.geosetArray && this.geosetArray[i] && !this.geosetArray[i].checked)
				continue;

			const mesh = all_meshes[i];
			const mesh_geometry = mesh.geometry;
			const index_attr = mesh_geometry.getIndex();

			if (!index_attr)
				continue;

			const groups = mesh_geometry.groups;
			const geoset_id = this.geosetArray?.[i]?.id ?? i;
			const geoset_name = GeosetMapper.getGeosetName(i, geoset_id);

			if (groups.length === 0) {
				// no groups defined - shouldn't happen for M2, but handle it
				const indices = Array.from(index_attr.array);
				obj.addMesh(geoset_name, indices, default_mat_name);
			} else {
				// extract triangles from the group range
				// M2 submeshes typically have one group per mesh
				for (const group of groups) {
					const start = group.start;
					const count = group.count;
					const indices = [];

					for (let j = 0; j < count; j++)
						indices.push(index_attr.getX(start + j));

					// group.materialIndex is the texture index from m2.textureCombos
					// use m2.textureTypes to get the texture type for chr_materials lookup
					let mat_name = default_mat_name;
					const tex_index = group.materialIndex;
					if (tex_index !== null && tex_index !== undefined && this.m2?.textureTypes) {
						const tex_type = this.m2.textureTypes[tex_index];
						if (texture_map.has(tex_type))
							mat_name = texture_map.get(tex_type);
					}

					obj.addMesh(geoset_name, indices, mat_name);
				}
			}
		}

		if (!mtl.isEmpty)
			obj.setMaterialLibrary(path.basename(mtl.out));

		await obj.write(config.overwriteFiles);
		await mtl.write(config.overwriteFiles);

		log.write('Character OBJ export complete: %s', out);
	}
}

module.exports = ViewerOBJExporter;
