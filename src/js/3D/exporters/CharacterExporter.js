/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */


import log from '../../log.js';

/**
 * Transform a position by a 4x4 matrix
 */
function transform_position(x, y, z, mat) {
	return [
		mat[0] * x + mat[4] * y + mat[8] * z + mat[12],
		mat[1] * x + mat[5] * y + mat[9] * z + mat[13],
		mat[2] * x + mat[6] * y + mat[10] * z + mat[14]
	];
}

/**
 * Transform a normal by the upper 3x3 of a 4x4 matrix (no translation)
 */
function transform_normal(x, y, z, mat) {
	const nx = mat[0] * x + mat[4] * y + mat[8] * z;
	const ny = mat[1] * x + mat[5] * y + mat[9] * z;
	const nz = mat[2] * x + mat[6] * y + mat[10] * z;

	// normalize
	const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
	if (len > 0.0001)
		return [nx / len, ny / len, nz / len];

	return [nx, ny, nz];
}

/**
 * Bake bone transforms into geometry using provided bone matrices.
 * This replicates getBakedGeometry but uses explicit bone matrices.
 */
function bake_geometry_with_bones(m2, bone_matrices) {
	const src_verts = m2.vertices;
	const src_normals = m2.normals;
	const bone_indices = m2.boneIndices;
	const bone_weights = m2.boneWeights;

	const vertex_count = src_verts.length / 3;
	const out_verts = new Float32Array(vertex_count * 3);
	const out_normals = new Float32Array(vertex_count * 3);

	if (!bone_indices || !bone_weights || !bone_matrices) {
		out_verts.set(src_verts);
		out_normals.set(src_normals);
		return { vertices: out_verts, normals: out_normals };
	}

	for (let i = 0; i < vertex_count; i++) {
		const v_idx = i * 3;
		const b_idx = i * 4;

		const vx = src_verts[v_idx];
		const vy = src_verts[v_idx + 1];
		const vz = src_verts[v_idx + 2];

		const nx = src_normals[v_idx];
		const ny = src_normals[v_idx + 1];
		const nz = src_normals[v_idx + 2];

		let out_x = 0, out_y = 0, out_z = 0;
		let out_nx = 0, out_ny = 0, out_nz = 0;

		// blend up to 4 bone influences
		for (let j = 0; j < 4; j++) {
			const bone_idx = bone_indices[b_idx + j];
			const weight = bone_weights[b_idx + j] / 255;

			if (weight === 0)
				continue;

			const mat_offset = bone_idx * 16;
			if (mat_offset + 16 > bone_matrices.length)
				continue;

			const m = bone_matrices;

			// transform position
			const tx = m[mat_offset + 0] * vx + m[mat_offset + 4] * vy + m[mat_offset + 8] * vz + m[mat_offset + 12];
			const ty = m[mat_offset + 1] * vx + m[mat_offset + 5] * vy + m[mat_offset + 9] * vz + m[mat_offset + 13];
			const tz = m[mat_offset + 2] * vx + m[mat_offset + 6] * vy + m[mat_offset + 10] * vz + m[mat_offset + 14];

			out_x += tx * weight;
			out_y += ty * weight;
			out_z += tz * weight;

			// transform normal (no translation)
			const tnx = m[mat_offset + 0] * nx + m[mat_offset + 4] * ny + m[mat_offset + 8] * nz;
			const tny = m[mat_offset + 1] * nx + m[mat_offset + 5] * ny + m[mat_offset + 9] * nz;
			const tnz = m[mat_offset + 2] * nx + m[mat_offset + 6] * ny + m[mat_offset + 10] * nz;

			out_nx += tnx * weight;
			out_ny += tny * weight;
			out_nz += tnz * weight;
		}

		// normalize the blended normal
		const len = Math.sqrt(out_nx * out_nx + out_ny * out_ny + out_nz * out_nz);
		if (len > 0.0001) {
			out_nx /= len;
			out_ny /= len;
			out_nz /= len;
		}

		out_verts[v_idx] = out_x;
		out_verts[v_idx + 1] = out_y;
		out_verts[v_idx + 2] = out_z;

		out_normals[v_idx] = out_nx;
		out_normals[v_idx + 1] = out_ny;
		out_normals[v_idx + 2] = out_nz;
	}

	return { vertices: out_verts, normals: out_normals };
}

/**
 * Remap bone indices from equipment model to character skeleton
 */
function remap_bone_indices(bone_indices, remap_table) {
	const remapped = new Uint8Array(bone_indices.length);

	for (let i = 0; i < bone_indices.length; i++) {
		const original_idx = bone_indices[i];
		if (original_idx < remap_table.length)
			remapped[i] = remap_table[original_idx];
		else
			remapped[i] = original_idx;
	}

	return remapped;
}

/**
 * Apply a transform matrix to all vertices and normals
 */
function apply_transform_to_geometry(vertices, normals, transform) {
	const vertex_count = vertices.length / 3;
	const out_verts = new Float32Array(vertex_count * 3);
	const out_normals = new Float32Array(vertex_count * 3);

	for (let i = 0; i < vertex_count; i++) {
		const vi = i * 3;
		const vx = vertices[vi], vy = vertices[vi + 1], vz = vertices[vi + 2];
		const nx = normals[vi], ny = normals[vi + 1], nz = normals[vi + 2];

		const [tx, ty, tz] = transform_position(vx, vy, vz, transform);
		const [tnx, tny, tnz] = transform_normal(nx, ny, nz, transform);

		out_verts[vi] = tx;
		out_verts[vi + 1] = ty;
		out_verts[vi + 2] = tz;

		out_normals[vi] = tnx;
		out_normals[vi + 1] = tny;
		out_normals[vi + 2] = tnz;
	}

	return { vertices: out_verts, normals: out_normals };
}

/**
 * Collects equipment model data for export, handling transforms and geometry baking.
 */
class CharacterExporter {
	/**
	 * @param {M2RendererGL} char_renderer - character renderer with bone matrices
	 * @param {Map} equipment_renderers - slot_id -> { renderers: [{renderer, attachment_id, is_collection_style}], item_id }
	 * @param {Map} collection_renderers - slot_id -> { renderers: [renderer], item_id }
	 */
	constructor(char_renderer, equipment_renderers, collection_renderers) {
		this.char_renderer = char_renderer;
		this.equipment_renderers = equipment_renderers || new Map();
		this.collection_renderers = collection_renderers || new Map();
	}

	/**
	 * Check if there are any equipment models to export
	 */
	has_equipment() {
		return this.equipment_renderers.size > 0 || this.collection_renderers.size > 0;
	}

	/**
	 * Get all equipment models with their transforms applied.
	 * Returns geometry ready for export (vertices/normals already transformed).
	 * @param {boolean} apply_pose - apply current animation pose to equipment
	 * @returns {Array<{slot_id, item_id, renderer, vertices, normals, uv, uv2}>}
	 */
	get_equipment_geometry(apply_pose = true) {
		const results = [];
		const char_bone_matrices = this.char_renderer?.bone_matrices;

		// process attachment models (weapons, helms, shoulders, etc)
		for (const [slot_id, entry] of this.equipment_renderers) {
			for (const { renderer, attachment_id, is_collection_style } of entry.renderers) {
				if (!renderer?.m2)
					continue;

				const geometry = this._process_equipment_renderer(
					renderer,
					attachment_id,
					is_collection_style,
					char_bone_matrices,
					apply_pose
				);

				if (geometry) {
					results.push({
						slot_id,
						item_id: entry.item_id,
						attachment_id,
						is_collection_style,
						renderer,
						...geometry
					});
				}
			}
		}

		// process collection models (armor pieces that share character skeleton)
		for (const [slot_id, entry] of this.collection_renderers) {
			for (const renderer of entry.renderers) {
				if (!renderer?.m2)
					continue;

				const geometry = this._process_equipment_renderer(
					renderer,
					undefined,
					true,
					char_bone_matrices,
					apply_pose
				);

				if (geometry) {
					results.push({
						slot_id,
						item_id: entry.item_id,
						is_collection_style: true,
						renderer,
						...geometry
					});
				}
			}
		}

		return results;
	}

	/**
	 * Process a single equipment renderer and get posed geometry
	 * @private
	 */
	_process_equipment_renderer(renderer, attachment_id, is_collection_style, char_bone_matrices, apply_pose) {
		const m2 = renderer.m2;
		if (!m2)
			return null;

		let vertices, normals;
		let boneIndices = null;
		let boneWeights = null;

		if (is_collection_style && apply_pose && char_bone_matrices) {
			// collection-style models use character's bone matrices via remapping
			// first ensure bone matrices are updated from character
			if (renderer.applyExternalBoneMatrices)
				renderer.applyExternalBoneMatrices(char_bone_matrices);

			// bake geometry using the remapped bone matrices
			if (renderer.bone_matrices && m2.boneIndices && m2.boneWeights) {
				const baked = bake_geometry_with_bones(m2, renderer.bone_matrices);
				vertices = baked.vertices;
				normals = baked.normals;
			} else {
				vertices = new Float32Array(m2.vertices);
				normals = new Float32Array(m2.normals);
			}

			// for GLTF export, we need remapped bone indices
			if (renderer.bone_remap_table && m2.boneIndices) {
				boneIndices = remap_bone_indices(m2.boneIndices, renderer.bone_remap_table);
				boneWeights = m2.boneWeights;
			}
		} else if (!is_collection_style && attachment_id !== undefined && apply_pose) {
			// attachment models need the attachment transform applied
			const attach_transform = this.char_renderer?.getAttachmentTransform?.(attachment_id);

			if (attach_transform) {
				const transformed = apply_transform_to_geometry(m2.vertices, m2.normals, attach_transform);
				vertices = transformed.vertices;
				normals = transformed.normals;
			} else {
				vertices = new Float32Array(m2.vertices);
				normals = new Float32Array(m2.normals);
			}
		} else {
			// no pose - use original geometry
			vertices = new Float32Array(m2.vertices);
			normals = new Float32Array(m2.normals);

			// still provide remapped bone indices for non-posed GLTF export
			if (is_collection_style && renderer.bone_remap_table && m2.boneIndices) {
				boneIndices = remap_bone_indices(m2.boneIndices, renderer.bone_remap_table);
				boneWeights = m2.boneWeights;
			}
		}

		return {
			vertices,
			normals,
			uv: m2.uv,
			uv2: m2.uv2,
			boneIndices,
			boneWeights
		};
	}

	/**
	 * Get list of all equipment slots with models
	 */
	get_equipped_slots() {
		const slots = new Set();

		for (const slot_id of this.equipment_renderers.keys())
			slots.add(slot_id);

		for (const slot_id of this.collection_renderers.keys())
			slots.add(slot_id);

		return Array.from(slots).sort((a, b) => a - b);
	}

	/**
	 * Get item ID for a slot
	 */
	get_item_id_for_slot(slot_id) {
		return this.equipment_renderers.get(slot_id)?.item_id
			|| this.collection_renderers.get(slot_id)?.item_id
			|| null;
	}
}

export default CharacterExporter;