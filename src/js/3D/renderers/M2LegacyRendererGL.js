/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2LegacyLoader = require('../loaders/M2LegacyLoader');
const GeosetMapper = require('../GeosetMapper');
const Shaders = require('../Shaders');

const VertexArray = require('../gl/VertexArray');
const GLTexture = require('../gl/GLTexture');

const textureRibbon = require('../../ui/texture-ribbon');

// m2 version constants
const M2_VER_WOTLK = 264;

// identity matrix
const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

// legacy shaders are simpler - map to basic shader ids
const LEGACY_VERTEX_SHADER = 0; // Diffuse_T1
const LEGACY_PIXEL_SHADER = 0;  // Combiners_Opaque

function mat4_multiply(out, a, b) {
	const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

	let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
	out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
	out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
	out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
}

function mat4_from_translation(out, x, y, z) {
	out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
	out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
}

function mat4_from_quat(out, x, y, z, w) {
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;

	out[0] = 1 - (yy + zz);
	out[1] = xy + wz;
	out[2] = xz - wy;
	out[3] = 0;

	out[4] = xy - wz;
	out[5] = 1 - (xx + zz);
	out[6] = yz + wx;
	out[7] = 0;

	out[8] = xz + wy;
	out[9] = yz - wx;
	out[10] = 1 - (xx + yy);
	out[11] = 0;

	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
}

function mat4_from_scale(out, x, y, z) {
	out[0] = x; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = y; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = z; out[11] = 0;
	out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

function mat4_copy(out, src) {
	out.set(src);
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function quat_slerp(out, ax, ay, az, aw, bx, by, bz, bw, t) {
	let cosom = ax * bx + ay * by + az * bz + aw * bw;

	if (cosom < 0) {
		cosom = -cosom;
		bx = -bx; by = -by; bz = -bz; bw = -bw;
	}

	let scale0, scale1;
	if (1 - cosom > 0.000001) {
		const omega = Math.acos(cosom);
		const sinom = Math.sin(omega);
		scale0 = Math.sin((1 - t) * omega) / sinom;
		scale1 = Math.sin(t * omega) / sinom;
	} else {
		scale0 = 1 - t;
		scale1 = t;
	}

	out[0] = scale0 * ax + scale1 * bx;
	out[1] = scale0 * ay + scale1 * by;
	out[2] = scale0 * az + scale1 * bz;
	out[3] = scale0 * aw + scale1 * bw;
}

class M2LegacyRendererGL {
	constructor(data, gl_context, reactive = false, useRibbon = true) {
		this.data = data;
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.reactive = reactive;
		this.useRibbon = useRibbon;

		this.m2 = null;
		this.syncID = -1;

		// rendering state
		this.vaos = [];
		this.textures = new Map();
		this.default_texture = null;
		this.buffers = [];
		this.draw_calls = [];

		// animation state
		this.bones = null;
		this.bone_matrices = null;
		this.current_animation = null;
		this.animation_time = 0;
		this.animation_paused = false;

		// reactive state
		this.geosetKey = 'modelViewerGeosets';
		this.geosetArray = null;

		// transforms
		this.model_matrix = new Float32Array(IDENTITY_MAT4);
		this.position = [0, 0, 0];
		this.rotation = [0, 0, 0];
		this.scale = [1, 1, 1];

		// material data
		this.material_props = new Map();
	}

	static load_shaders(ctx) {
		return Shaders.create_program(ctx, 'm2');
	}

	async load() {
		this.m2 = new M2LegacyLoader(this.data);
		await this.m2.load();

		this.shader = M2LegacyRendererGL.load_shaders(this.ctx);

		this._create_default_texture();
		await this._load_textures();

		if (this.m2.vertices.length > 0) {
			await this.loadSkin(0);

			if (this.reactive) {
				this.geosetWatcher = core.view.$watch(this.geosetKey, () => this.updateGeosets(), { deep: true });
				this.wireframeWatcher = core.view.$watch('config.modelViewerWireframe', () => {}, { deep: true });
			}
		}

		this.data = undefined;
	}

	_create_default_texture() {
		const pixels = new Uint8Array([87, 175, 226, 255]);
		this.default_texture = new GLTexture(this.ctx);
		this.default_texture.set_rgba(pixels, 1, 1, { has_alpha: false });
	}

	async _load_textures() {
		const textures = this.m2.textures;
		const mpq = core.view.mpq;

		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];
			const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;

			// legacy textures use fileName property set by loader
			const fileName = texture.fileName;

			if (fileName && fileName.length > 0) {
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, fileName, this.syncID);

				try {
					const data = mpq.getFile(fileName);

					if (data) {
						const BufferWrapper = require('../../buffer');
						const blp = new BLPFile(new BufferWrapper(Buffer.from(data)));
						const gl_tex = new GLTexture(this.ctx);
						gl_tex.set_blp(blp, { flags: texture.flags });
						this.textures.set(i, gl_tex);

						if (ribbonSlot !== null)
							textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);
					}
				} catch (e) {
					log.write('Failed to load legacy texture %s: %s', fileName, e.message);
				}
			}
		}
	}

	/**
	 * Apply creature skin textures (replaceable textures from CreatureDisplayInfo)
	 * @param {string[]} texture_paths - Array of texture file paths
	 */
	async applyCreatureSkin(texture_paths) {
		const mpq = core.view.mpq;
		const textureTypes = this.m2.textureTypes;

		// creature skins map to textureType 11, 12, 13 (Monster1, Monster2, Monster3)
		const MONSTER_TEX_START = 11;

		for (let i = 0; i < textureTypes.length; i++) {
			const textureType = textureTypes[i];

			// check if this is a monster replaceable texture slot
			if (textureType >= MONSTER_TEX_START && textureType < MONSTER_TEX_START + 3) {
				const skin_index = textureType - MONSTER_TEX_START;

				if (skin_index < texture_paths.length) {
					const texture_path = texture_paths[skin_index];

					try {
						const data = mpq.getFile(texture_path);
						if (data) {
							const BufferWrapper = require('../../buffer');
							const blp = new BLPFile(new BufferWrapper(Buffer.from(data)));
							const gl_tex = new GLTexture(this.ctx);
							gl_tex.set_blp(blp, { flags: this.m2.textures[i].flags });
							this.textures.set(i, gl_tex);

							log.write('Applied creature skin texture %d: %s', i, texture_path);
						}
					} catch (e) {
						log.write('Failed to apply creature skin texture %s: %s', texture_path, e.message);
					}
				}
			}
		}
	}

	async loadSkin(index) {
		this._dispose_skin();

		const m2 = this.m2;
		const skin = await m2.getSkin(index);
		const gl = this.gl;

		this._create_skeleton();

		// build interleaved vertex buffer
		// format: position(3f) + normal(3f) + bone_idx(4ub) + bone_weight(4ub) + uv(2f) = 40 bytes
		const vertex_count = m2.vertices.length / 3;
		const stride = 40;
		const vertex_data = new ArrayBuffer(vertex_count * stride);
		const vertex_view = new DataView(vertex_data);

		for (let i = 0; i < vertex_count; i++) {
			const offset = i * stride;
			const v_idx = i * 3;
			const uv_idx = i * 2;
			const bone_idx = i * 4;

			// position
			vertex_view.setFloat32(offset + 0, m2.vertices[v_idx], true);
			vertex_view.setFloat32(offset + 4, m2.vertices[v_idx + 1], true);
			vertex_view.setFloat32(offset + 8, m2.vertices[v_idx + 2], true);

			// normal
			vertex_view.setFloat32(offset + 12, m2.normals[v_idx], true);
			vertex_view.setFloat32(offset + 16, m2.normals[v_idx + 1], true);
			vertex_view.setFloat32(offset + 20, m2.normals[v_idx + 2], true);

			// bone indices
			vertex_view.setUint8(offset + 24, m2.boneIndices[bone_idx]);
			vertex_view.setUint8(offset + 25, m2.boneIndices[bone_idx + 1]);
			vertex_view.setUint8(offset + 26, m2.boneIndices[bone_idx + 2]);
			vertex_view.setUint8(offset + 27, m2.boneIndices[bone_idx + 3]);

			// bone weights
			vertex_view.setUint8(offset + 28, m2.boneWeights[bone_idx]);
			vertex_view.setUint8(offset + 29, m2.boneWeights[bone_idx + 1]);
			vertex_view.setUint8(offset + 30, m2.boneWeights[bone_idx + 2]);
			vertex_view.setUint8(offset + 31, m2.boneWeights[bone_idx + 3]);

			// texcoord
			vertex_view.setFloat32(offset + 32, m2.uv[uv_idx], true);
			vertex_view.setFloat32(offset + 36, m2.uv[uv_idx + 1], true);
		}

		// map triangle indices
		const index_data = new Uint16Array(skin.triangles.length);
		for (let i = 0; i < skin.triangles.length; i++)
			index_data[i] = skin.indices[skin.triangles[i]];

		// create VAO
		const vao = new VertexArray(this.ctx);
		vao.bind();

		const vbo = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.STATIC_DRAW);
		this.buffers.push(vbo);
		vao.vbo = vbo;

		const ebo = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index_data, gl.STATIC_DRAW);
		this.buffers.push(ebo);
		vao.ebo = ebo;

		vao.setup_m2_vertex_format();
		this.vaos.push(vao);

		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

		// build draw calls per submesh
		this.draw_calls = [];

		for (let i = 0; i < skin.subMeshes.length; i++) {
			const submesh = skin.subMeshes[i];
			const tex_unit = skin.textureUnits.find(tu => tu.skinSectionIndex === i);

			let tex_indices = [null, null, null, null];
			let vertex_shader = LEGACY_VERTEX_SHADER;
			let pixel_shader = LEGACY_PIXEL_SHADER;
			let blend_mode = 0;
			let flags = 0;
			let texture_count = 1;

			if (tex_unit) {
				texture_count = tex_unit.textureCount;

				for (let j = 0; j < Math.min(texture_count, 4); j++) {
					const combo_idx = tex_unit.textureComboIndex + j;
					if (combo_idx < m2.textureCombos.length)
						tex_indices[j] = m2.textureCombos[combo_idx];
				}

				const mat = m2.materials[tex_unit.materialIndex];
				if (mat) {
					blend_mode = mat.blendingMode;
					flags = mat.flags;
					this.material_props.set(tex_indices[0], { blendMode: blend_mode, flags: flags });
				}
			}

			const draw_call = {
				vao: vao,
				start: submesh.triangleStart,
				count: submesh.triangleCount,
				tex_indices: tex_indices,
				texture_count: texture_count,
				vertex_shader: vertex_shader,
				pixel_shader: pixel_shader,
				blend_mode: blend_mode,
				flags: flags,
				visible: true
			};

			this.draw_calls.push(draw_call);

			if (this.reactive) {
				let is_default = (submesh.submeshID === 0 || submesh.submeshID.toString().endsWith('01') || submesh.submeshID.toString().startsWith('32'));
				if (submesh.submeshID.toString().startsWith('17') || submesh.submeshID.toString().startsWith('35'))
					is_default = false;

				this.geosetArray[i] = { label: 'Geoset ' + i, checked: is_default, id: submesh.submeshID };
				draw_call.visible = is_default;
			}
		}

		if (this.reactive) {
			core.view[this.geosetKey] = this.geosetArray;
			GeosetMapper.map(this.geosetArray);
		}

		this.updateGeosets();
	}

	_create_skeleton() {
		const m2 = this.m2;
		const bone_data = m2.bones;

		if (!bone_data || bone_data.length === 0) {
			this.bones = null;
			this.bone_matrices = new Float32Array(16);
			return;
		}

		this.bones = bone_data;
		this.bone_matrices = new Float32Array(bone_data.length * 16);

		for (let i = 0; i < bone_data.length; i++)
			this.bone_matrices.set(IDENTITY_MAT4, i * 16);
	}

	async playAnimation(index) {
		this.current_animation = index;
		this.animation_time = 0;
	}

	stopAnimation() {
		this.current_animation = null;
		this.animation_time = 0;
		this.animation_paused = false;

		if (this.bones) {
			for (let i = 0; i < this.bones.length; i++)
				this.bone_matrices.set(IDENTITY_MAT4, i * 16);
		}
	}

	updateAnimation(delta_time) {
		if (this.current_animation === null || !this.bones)
			return;

		const anim = this.m2.animations?.[this.current_animation];
		if (!anim)
			return;

		if (!this.animation_paused)
			this.animation_time += delta_time;

		const duration_sec = anim.duration / 1000;
		if (duration_sec > 0)
			this.animation_time = this.animation_time % duration_sec;

		this._update_bone_matrices();
	}

	get_animation_duration() {
		if (this.current_animation === null)
			return 0;

		const anim = this.m2.animations?.[this.current_animation];
		return anim ? anim.duration / 1000 : 0;
	}

	get_animation_frame_count() {
		const duration = this.get_animation_duration();
		return Math.max(1, Math.floor(duration * 60));
	}

	get_animation_frame() {
		const duration = this.get_animation_duration();
		if (duration <= 0)
			return 0;

		return Math.floor((this.animation_time / duration) * this.get_animation_frame_count());
	}

	set_animation_frame(frame) {
		const frame_count = this.get_animation_frame_count();
		if (frame_count <= 0)
			return;

		const duration = this.get_animation_duration();
		this.animation_time = (frame / frame_count) * duration;
		this._update_bone_matrices();
	}

	set_animation_paused(paused) {
		this.animation_paused = paused;
	}

	step_animation_frame(delta) {
		const frame = this.get_animation_frame();
		const frame_count = this.get_animation_frame_count();
		let new_frame = frame + delta;

		if (new_frame < 0)
			new_frame = frame_count - 1;
		else if (new_frame >= frame_count)
			new_frame = 0;

		this.set_animation_frame(new_frame);
	}

	_update_bone_matrices() {
		const time_ms = this.animation_time * 1000;
		const bones = this.bones;
		const bone_count = bones.length;
		const anim_idx = this.current_animation;
		const m2 = this.m2;

		// for legacy single-timeline, get animation time range
		let anim_start = 0;
		let anim_end = 0;
		if (m2.version < M2_VER_WOTLK && m2.animations[anim_idx]) {
			anim_start = m2.animations[anim_idx].startTimestamp;
			anim_end = m2.animations[anim_idx].endTimestamp;
		}

		const local_mat = new Float32Array(16);
		const trans_mat = new Float32Array(16);
		const rot_mat = new Float32Array(16);
		const scale_mat = new Float32Array(16);
		const pivot_mat = new Float32Array(16);
		const neg_pivot_mat = new Float32Array(16);
		const temp_result = new Float32Array(16);

		const calculated = new Array(bone_count).fill(false);

		const calc_bone = (idx) => {
			if (calculated[idx])
				return;

			const bone = bones[idx];
			const parent_idx = bone.parentBone;

			if (parent_idx >= 0 && parent_idx < bone_count)
				calc_bone(parent_idx);

			const pivot = bone.pivot;
			const px = pivot[0], py = pivot[1], pz = pivot[2];

			// check for animation data
			let has_trans, has_rot, has_scale;

			if (m2.version < M2_VER_WOTLK) {
				// legacy single-timeline
				has_trans = bone.translation?.values?.length > 0;
				has_rot = bone.rotation?.values?.length > 0;
				has_scale = bone.scale?.values?.length > 0;
			} else {
				// per-animation timeline
				has_trans = bone.translation?.timestamps?.[anim_idx]?.length > 0;
				has_rot = bone.rotation?.timestamps?.[anim_idx]?.length > 0;
				has_scale = bone.scale?.timestamps?.[anim_idx]?.length > 0;
			}

			const has_animation = has_trans || has_rot || has_scale;

			mat4_copy(local_mat, IDENTITY_MAT4);

			if (has_animation) {
				mat4_from_translation(pivot_mat, px, py, pz);
				mat4_multiply(temp_result, local_mat, pivot_mat);
				mat4_copy(local_mat, temp_result);

				if (has_trans) {
					let tx, ty, tz;
					if (m2.version < M2_VER_WOTLK) {
						[tx, ty, tz] = this._sample_legacy_vec3(bone.translation, time_ms, anim_start, anim_end);
					} else {
						const ts = bone.translation.timestamps[anim_idx];
						const vals = bone.translation.values[anim_idx];
						[tx, ty, tz] = this._sample_vec3(ts, vals, time_ms);
					}

					mat4_from_translation(trans_mat, tx, ty, tz);
					mat4_multiply(temp_result, local_mat, trans_mat);
					mat4_copy(local_mat, temp_result);
				}

				if (has_rot) {
					let qx, qy, qz, qw;
					if (m2.version < M2_VER_WOTLK) {
						[qx, qy, qz, qw] = this._sample_legacy_quat(bone.rotation, time_ms, anim_start, anim_end);
					} else {
						const ts = bone.rotation.timestamps[anim_idx];
						const vals = bone.rotation.values[anim_idx];
						[qx, qy, qz, qw] = this._sample_quat(ts, vals, time_ms);
					}

					mat4_from_quat(rot_mat, qx, qy, qz, qw);
					mat4_multiply(temp_result, local_mat, rot_mat);
					mat4_copy(local_mat, temp_result);
				}

				if (has_scale) {
					let sx, sy, sz;
					if (m2.version < M2_VER_WOTLK) {
						[sx, sy, sz] = this._sample_legacy_vec3(bone.scale, time_ms, anim_start, anim_end);
					} else {
						const ts = bone.scale.timestamps[anim_idx];
						const vals = bone.scale.values[anim_idx];
						[sx, sy, sz] = this._sample_vec3(ts, vals, time_ms);
					}

					mat4_from_scale(scale_mat, sx, sy, sz);
					mat4_multiply(temp_result, local_mat, scale_mat);
					mat4_copy(local_mat, temp_result);
				}

				mat4_from_translation(neg_pivot_mat, -px, -py, -pz);
				mat4_multiply(temp_result, local_mat, neg_pivot_mat);
				mat4_copy(local_mat, temp_result);
			}

			const offset = idx * 16;
			if (parent_idx >= 0 && parent_idx < bone_count) {
				const parent_offset = parent_idx * 16;
				const parent_mat = this.bone_matrices.subarray(parent_offset, parent_offset + 16);
				mat4_multiply(this.bone_matrices.subarray(offset, offset + 16), parent_mat, local_mat);
			} else {
				this.bone_matrices.set(local_mat, offset);
			}

			calculated[idx] = true;
		};

		for (let i = 0; i < bone_count; i++)
			calc_bone(i);
	}

	// legacy single-timeline sampling: uses ranges array to find keyframes within animation bounds
	_sample_legacy_vec3(track, time_ms, anim_start, anim_end) {
		const timestamps = track.timestamps;
		const values = track.values;
		const ranges = track.ranges;

		if (!timestamps || timestamps.length === 0)
			return [0, 0, 0];

		// absolute time in global timeline
		const abs_time = anim_start + time_ms;

		// find keyframes within this animation's range
		let start_idx = 0;
		let end_idx = timestamps.length - 1;

		// use ranges if available to narrow search
		if (ranges && ranges.length > 0) {
			// ranges contains [start, end] pairs for each animation
			// but in legacy format, all animations share single timeline
			// find relevant range by searching
		}

		// find keyframes
		if (timestamps.length === 1 || abs_time <= timestamps[0]) {
			const v = values[0];
			return [v[0], v[1], v[2]];
		}

		if (abs_time >= timestamps[timestamps.length - 1]) {
			const v = values[values.length - 1];
			return [v[0], v[1], v[2]];
		}

		let frame = 0;
		for (let i = 0; i < timestamps.length - 1; i++) {
			if (abs_time >= timestamps[i] && abs_time < timestamps[i + 1]) {
				frame = i;
				break;
			}
		}

		const t0 = timestamps[frame];
		const t1 = timestamps[frame + 1];
		const alpha = (abs_time - t0) / (t1 - t0);

		const v0 = values[frame];
		const v1 = values[frame + 1];

		return [
			lerp(v0[0], v1[0], alpha),
			lerp(v0[1], v1[1], alpha),
			lerp(v0[2], v1[2], alpha)
		];
	}

	_sample_legacy_quat(track, time_ms, anim_start, anim_end) {
		const timestamps = track.timestamps;
		const values = track.values;

		if (!timestamps || timestamps.length === 0)
			return [0, 0, 0, 1];

		const abs_time = anim_start + time_ms;

		if (timestamps.length === 1 || abs_time <= timestamps[0]) {
			const v = values[0];
			return [v[0], v[1], v[2], v[3]];
		}

		if (abs_time >= timestamps[timestamps.length - 1]) {
			const v = values[values.length - 1];
			return [v[0], v[1], v[2], v[3]];
		}

		let frame = 0;
		for (let i = 0; i < timestamps.length - 1; i++) {
			if (abs_time >= timestamps[i] && abs_time < timestamps[i + 1]) {
				frame = i;
				break;
			}
		}

		const t0 = timestamps[frame];
		const t1 = timestamps[frame + 1];
		const alpha = (abs_time - t0) / (t1 - t0);

		const q0 = values[frame];
		const q1 = values[frame + 1];

		const out = [0, 0, 0, 1];
		quat_slerp(out, q0[0], q0[1], q0[2], q0[3], q1[0], q1[1], q1[2], q1[3], alpha);
		return out;
	}

	// per-animation timeline sampling (wotlk)
	_sample_vec3(timestamps, values, time_ms) {
		if (!timestamps || timestamps.length === 0)
			return [0, 0, 0];

		if (timestamps.length === 1 || time_ms <= timestamps[0]) {
			const v = values[0];
			return [v[0], v[1], v[2]];
		}

		if (time_ms >= timestamps[timestamps.length - 1]) {
			const v = values[values.length - 1];
			return [v[0], v[1], v[2]];
		}

		let frame = 0;
		for (let i = 0; i < timestamps.length - 1; i++) {
			if (time_ms >= timestamps[i] && time_ms < timestamps[i + 1]) {
				frame = i;
				break;
			}
		}

		const t0 = timestamps[frame];
		const t1 = timestamps[frame + 1];
		const alpha = (time_ms - t0) / (t1 - t0);

		const v0 = values[frame];
		const v1 = values[frame + 1];

		return [
			lerp(v0[0], v1[0], alpha),
			lerp(v0[1], v1[1], alpha),
			lerp(v0[2], v1[2], alpha)
		];
	}

	_sample_quat(timestamps, values, time_ms) {
		if (!timestamps || timestamps.length === 0)
			return [0, 0, 0, 1];

		if (timestamps.length === 1 || time_ms <= timestamps[0]) {
			const v = values[0];
			return [v[0], v[1], v[2], v[3]];
		}

		if (time_ms >= timestamps[timestamps.length - 1]) {
			const v = values[values.length - 1];
			return [v[0], v[1], v[2], v[3]];
		}

		let frame = 0;
		for (let i = 0; i < timestamps.length - 1; i++) {
			if (time_ms >= timestamps[i] && time_ms < timestamps[i + 1]) {
				frame = i;
				break;
			}
		}

		const t0 = timestamps[frame];
		const t1 = timestamps[frame + 1];
		const alpha = (time_ms - t0) / (t1 - t0);

		const q0 = values[frame];
		const q1 = values[frame + 1];

		const out = [0, 0, 0, 1];
		quat_slerp(out, q0[0], q0[1], q0[2], q0[3], q1[0], q1[1], q1[2], q1[3], alpha);
		return out;
	}

	updateGeosets() {
		if (!this.reactive || !this.geosetArray || !this.draw_calls)
			return;

		for (let i = 0; i < this.draw_calls.length && i < this.geosetArray.length; i++)
			this.draw_calls[i].visible = this.geosetArray[i].checked;
	}

	setTransform(position, rotation, scale) {
		this.position = position;
		this.rotation = rotation;
		this.scale = scale;
		this._update_model_matrix();
	}

	setTransformQuat(position, quat, scale) {
		const [px, py, pz] = position;
		const [qx, qy, qz, qw] = quat;
		const [sx, sy, sz] = scale;

		const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
		const xx = qx * x2, xy = qx * y2, xz = qx * z2;
		const yy = qy * y2, yz = qy * z2, zz = qz * z2;
		const wx = qw * x2, wy = qw * y2, wz = qw * z2;

		const m = this.model_matrix;
		m[0] = (1 - (yy + zz)) * sx;
		m[1] = (xy + wz) * sx;
		m[2] = (xz - wy) * sx;
		m[3] = 0;
		m[4] = (xy - wz) * sy;
		m[5] = (1 - (xx + zz)) * sy;
		m[6] = (yz + wx) * sy;
		m[7] = 0;
		m[8] = (xz + wy) * sz;
		m[9] = (yz - wx) * sz;
		m[10] = (1 - (xx + yy)) * sz;
		m[11] = 0;
		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	_update_model_matrix() {
		const m = this.model_matrix;
		const [px, py, pz] = this.position;
		const [rx, ry, rz] = this.rotation;
		const [sx, sy, sz] = this.scale;

		const cx = Math.cos(rx), sinx = Math.sin(rx);
		const cy = Math.cos(ry), siny = Math.sin(ry);
		const cz = Math.cos(rz), sinz = Math.sin(rz);

		m[0] = cy * cz * sx;
		m[1] = cy * sinz * sx;
		m[2] = -siny * sx;
		m[3] = 0;

		m[4] = (sinx * siny * cz - cx * sinz) * sy;
		m[5] = (sinx * siny * sinz + cx * cz) * sy;
		m[6] = sinx * cy * sy;
		m[7] = 0;

		m[8] = (cx * siny * cz + sinx * sinz) * sz;
		m[9] = (cx * siny * sinz - sinx * cz) * sz;
		m[10] = cx * cy * sz;
		m[11] = 0;

		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	render(view_matrix, projection_matrix) {
		if (!this.shader || this.draw_calls.length === 0)
			return;

		const gl = this.gl;
		const ctx = this.ctx;
		const shader = this.shader;
		const wireframe = core.view.config.modelViewerWireframe;

		shader.use();

		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);
		shader.set_uniform_3f('u_view_up', 0, 1, 0);
		shader.set_uniform_1f('u_time', performance.now() * 0.001);

		shader.set_uniform_1i('u_bone_count', this.bones ? this.bones.length : 0);
		if (this.bones && this.bone_matrices) {
			const loc = shader.get_uniform_location('u_bone_matrices');
			if (loc !== null)
				gl.uniformMatrix4fv(loc, false, this.bone_matrices);
		}

		shader.set_uniform_1i('u_has_tex_matrix1', 0);
		shader.set_uniform_1i('u_has_tex_matrix2', 0);
		shader.set_uniform_mat4('u_tex_matrix1', false, IDENTITY_MAT4);
		shader.set_uniform_mat4('u_tex_matrix2', false, IDENTITY_MAT4);

		const lx = 3, ly = -0.7, lz = -2;
		const light_view_x = view_matrix[0] * lx + view_matrix[4] * ly + view_matrix[8] * lz;
		const light_view_y = view_matrix[1] * lx + view_matrix[5] * ly + view_matrix[9] * lz;
		const light_view_z = view_matrix[2] * lx + view_matrix[6] * ly + view_matrix[10] * lz;

		shader.set_uniform_1i('u_apply_lighting', 1);
		shader.set_uniform_3f('u_ambient_color', 0.5, 0.5, 0.5);
		shader.set_uniform_3f('u_diffuse_color', 0.7, 0.7, 0.7);
		shader.set_uniform_3f('u_light_dir', light_view_x, light_view_y, light_view_z);

		shader.set_uniform_1i('u_wireframe', wireframe ? 1 : 0);
		shader.set_uniform_4f('u_wireframe_color', 1, 1, 1, 1);

		shader.set_uniform_1f('u_alpha_test', 0.501960814);

		shader.set_uniform_1i('u_texture1', 0);
		shader.set_uniform_1i('u_texture2', 1);
		shader.set_uniform_1i('u_texture3', 2);
		shader.set_uniform_1i('u_texture4', 3);

		shader.set_uniform_3f('u_tex_sample_alpha', 1, 1, 1);

		const sorted_calls = [...this.draw_calls].sort((a, b) => {
			const a_opaque = a.blend_mode === 0 || a.blend_mode === 1;
			const b_opaque = b.blend_mode === 0 || b.blend_mode === 1;
			if (a_opaque !== b_opaque)
				return a_opaque ? -1 : 1;

			return 0;
		});

		for (const dc of sorted_calls) {
			if (!dc.visible)
				continue;

			shader.set_uniform_1i('u_vertex_shader', dc.vertex_shader);
			shader.set_uniform_1i('u_pixel_shader', dc.pixel_shader);
			shader.set_uniform_1i('u_blend_mode', dc.blend_mode);

			shader.set_uniform_4f('u_mesh_color', 1, 1, 1, 1);

			ctx.apply_blend_mode(dc.blend_mode);

			if (dc.flags & 0x04) {
				ctx.set_cull_face(false);
			} else {
				ctx.set_cull_face(true);
				ctx.set_cull_mode(gl.BACK);
			}

			if (dc.flags & 0x08)
				ctx.set_depth_test(false);
			else
				ctx.set_depth_test(true);

			for (let t = 0; t < 4; t++) {
				const tex_idx = dc.tex_indices[t];
				const texture = (tex_idx !== null) ? (this.textures.get(tex_idx) || this.default_texture) : this.default_texture;
				texture.bind(t);
			}

			dc.vao.bind();
			gl.drawElements(
				wireframe ? gl.LINES : gl.TRIANGLES,
				dc.count,
				gl.UNSIGNED_SHORT,
				dc.start * 2
			);
		}

		ctx.set_blend(false);
		ctx.set_depth_test(true);
		ctx.set_depth_write(true);
		ctx.set_cull_face(false);
	}

	getBoundingBox() {
		if (!this.m2 || !this.m2.boundingBox)
			return null;

		const src_min = this.m2.boundingBox.min;
		const src_max = this.m2.boundingBox.max;

		return {
			min: [src_min[0], src_min[2], -src_max[1]],
			max: [src_max[0], src_max[2], -src_min[1]]
		};
	}

	_dispose_skin() {
		for (const vao of this.vaos)
			vao.dispose();

		this.vaos = [];
		this.buffers = [];
		this.draw_calls = [];

		if (this.geosetArray)
			this.geosetArray.splice(0);
	}

	dispose() {
		this.geosetWatcher?.();
		this.wireframeWatcher?.();

		this._dispose_skin();

		for (const tex of this.textures.values())
			tex.dispose();

		this.textures.clear();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}
	}
}

module.exports = M2LegacyRendererGL;
