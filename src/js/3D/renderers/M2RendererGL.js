/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../../core');
const log = require('../../log');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const SKELLoader = require('../loaders/SKELLoader');
const GeosetMapper = require('../GeosetMapper');
const ShaderMapper = require('../ShaderMapper');
const Shaders = require('../Shaders');

const GLContext = require('../gl/GLContext');
const VertexArray = require('../gl/VertexArray');
const GLTexture = require('../gl/GLTexture');

const textureRibbon = require('../../ui/texture-ribbon');
const UniformBuffer = require('../gl/UniformBuffer');

// vertex shader name to ID mapping (matches vertex shader switch cases)
const VERTEX_SHADER_IDS = {
	'Diffuse_T1': 0,
	'Diffuse_Env': 1,
	'Diffuse_T1_T2': 2,
	'Diffuse_T1_Env': 3,
	'Diffuse_Env_T1': 4,
	'Diffuse_Env_Env': 5,
	'Diffuse_T1_Env_T1': 6,
	'Diffuse_T1_T1': 7,
	'Diffuse_T1_T1_T1': 8,
	'Diffuse_EdgeFade_T1': 9,
	'Diffuse_T2': 10,
	'Diffuse_T1_Env_T2': 11,
	'Diffuse_EdgeFade_T1_T2': 12,
	'Diffuse_EdgeFade_Env': 13,
	'Diffuse_T1_T2_T1': 14,
	'Diffuse_T1_T2_T3': 15,
	'Color_T1_T2_T3': 16,
	'BW_Diffuse_T1': 17,
	'BW_Diffuse_T1_T2': 18
};

// pixel shader name to ID mapping (matches fragment shader switch cases)
const PIXEL_SHADER_IDS = {
	'Combiners_Opaque': 0,
	'Combiners_Mod': 1,
	'Combiners_Opaque_Mod': 2,
	'Combiners_Opaque_Mod2x': 3,
	'Combiners_Opaque_Mod2xNA': 4,
	'Combiners_Opaque_Opaque': 5,
	'Combiners_Mod_Mod': 6,
	'Combiners_Mod_Mod2x': 7,
	'Combiners_Mod_Add': 8,
	'Combiners_Mod_Mod2xNA': 9,
	'Combiners_Mod_AddNA': 10,
	'Combiners_Mod_Opaque': 11,
	'Combiners_Opaque_Mod2xNA_Alpha': 12,
	'Combiners_Opaque_AddAlpha': 13,
	'Combiners_Opaque_AddAlpha_Alpha': 14,
	'Combiners_Opaque_Mod2xNA_Alpha_Add': 15,
	'Combiners_Mod_AddAlpha': 16,
	'Combiners_Mod_AddAlpha_Alpha': 17,
	'Combiners_Opaque_Alpha_Alpha': 18,
	'Combiners_Opaque_Mod2xNA_Alpha_3s': 19,
	'Combiners_Opaque_AddAlpha_Wgt': 20,
	'Combiners_Mod_Add_Alpha': 21,
	'Combiners_Opaque_ModNA_Alpha': 22,
	'Combiners_Mod_AddAlpha_Wgt': 23,
	'Combiners_Opaque_Mod_Add_Wgt': 24,
	'Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha': 25,
	'Combiners_Mod_Dual_Crossfade': 26,
	'Combiners_Opaque_Mod2xNA_Alpha_Alpha': 27,
	'Combiners_Mod_Masked_Dual_Crossfade': 28,
	'Combiners_Opaque_Alpha': 29,
	'Guild': 30,
	'Guild_NoBorder': 31,
	'Guild_Opaque': 32,
	'Combiners_Mod_Depth': 33,
	'Illum': 34,
	'Combiners_Mod_Mod_Mod_Const': 35,
	'Combiners_Mod_Mod_Depth': 36
};

const M2BLEND_TO_EGX = [
	GLContext.BlendMode.OPAQUE,
	GLContext.BlendMode.ALPHA_KEY,
	GLContext.BlendMode.ALPHA,
	GLContext.BlendMode.NO_ALPHA_ADD,
	GLContext.BlendMode.ADD,
	GLContext.BlendMode.MOD,
	GLContext.BlendMode.MOD2X,
	GLContext.BlendMode.BLEND_ADD,
]

// identity matrix
const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

/**
 * multiply two 4x4 matrices (column-major): out = a * b
 * @param {Float32Array} out
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
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

/**
 * set matrix to translation
 * @param {Float32Array} out
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function mat4_from_translation(out, x, y, z) {
	out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
	out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
}

/**
 * set matrix from quaternion (x, y, z, w)
 * @param {Float32Array} out
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} w
 */
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

/**
 * set matrix to scale
 * @param {Float32Array} out
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function mat4_from_scale(out, x, y, z) {
	out[0] = x; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = y; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = z; out[11] = 0;
	out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

/**
 * copy matrix
 * @param {Float32Array} out
 * @param {Float32Array} src
 */
function mat4_copy(out, src) {
	out.set(src);
}

/**
 * build model matrix from position, quaternion rotation, and scale (TRS order)
 * quaternion format: [x, y, z, w]
 * @param {Float32Array} out
 * @param {number[]} position - [x, y, z]
 * @param {number[]} quat - [x, y, z, w]
 * @param {number[]} scale - [x, y, z]
 */
function mat4_from_quat_trs(out, position, quat, scale) {
	const [px, py, pz] = position;
	const [qx, qy, qz, qw] = quat;
	const [sx, sy, sz] = scale;

	// rotation from quaternion
	const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
	const xx = qx * x2, xy = qx * y2, xz = qx * z2;
	const yy = qy * y2, yz = qy * z2, zz = qz * z2;
	const wx = qw * x2, wy = qw * y2, wz = qw * z2;

	// column 0 (scaled)
	out[0] = (1 - (yy + zz)) * sx;
	out[1] = (xy + wz) * sx;
	out[2] = (xz - wy) * sx;
	out[3] = 0;

	// column 1 (scaled)
	out[4] = (xy - wz) * sy;
	out[5] = (1 - (xx + zz)) * sy;
	out[6] = (yz + wx) * sy;
	out[7] = 0;

	// column 2 (scaled)
	out[8] = (xz + wy) * sz;
	out[9] = (yz - wx) * sz;
	out[10] = (1 - (xx + yy)) * sz;
	out[11] = 0;

	// column 3 (translation)
	out[12] = px;
	out[13] = py;
	out[14] = pz;
	out[15] = 1;
}

/**
 * linear interpolate between two values
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t) {
	return a + (b - a) * t;
}

/**
 * spherical linear interpolation for quaternions
 * @param {number[]} out - [x, y, z, w]
 * @param {number} ax
 * @param {number} ay
 * @param {number} az
 * @param {number} aw
 * @param {number} bx
 * @param {number} by
 * @param {number} bz
 * @param {number} bw
 * @param {number} t
 */
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

class M2RendererGL {
	/**
	 * @param {BufferWrapper} data
	 * @param {GLContext} gl_context
	 * @param {boolean} [reactive=false]
	 * @param {boolean} [useRibbon=true]
	 */
	constructor(data, gl_context, reactive = false, useRibbon = true) {
		this.data = data;
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.reactive = reactive;
		this.useRibbon = useRibbon;

		this.m2 = null;
		this.skelLoader = null;
		this.syncID = -1;

		// rendering state
		this.vaos = [];
		this.ubos = [];
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
		this.tex_matrices = null;

		// global sequences
		this.global_seq_times = new Float32Array();

		// hand grip state for weapon attachment
		// when true, finger bones use HandsClosed animation (ID 15)
		this.close_right_hand = false;
		this.close_left_hand = false;
		this.hands_closed_anim_idx = null;

		// collection model support
		this.bone_remap_table = null;
		this.use_external_bones = false;

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
		this.shader_map = new Map();
	}

	/**
	 * Load shader program
	 */
	static load_shaders(ctx) {
		return Shaders.create_program(ctx, 'm2');
	}

	async load() {
		// parse M2 data
		this.m2 = new M2Loader(this.data);
		await this.m2.load();

		// load shader program
		this.shader = M2RendererGL.load_shaders(this.ctx);

		this._create_tex_matrices();

		// create default texture
		this._create_default_texture();

		// load textures
		await this._load_textures();
		this.global_seq_times = new Float32Array(this.m2.globalLoops.length);

		// load first skin
		if (this.m2.vertices.length > 0) {
			await this.loadSkin(0);

			if (this.reactive) {
				this.geosetWatcher = core.view.$watch(this.geosetKey, () => this.updateGeosets(), { deep: true });
				this.wireframeWatcher = core.view.$watch('config.modelViewerWireframe', () => {}, { deep: true });
				this.bonesWatcher = core.view.$watch('config.modelViewerShowBones', () => {}, { deep: true });
			}
		}

		// drop reference to raw data
		this.data = undefined;
	}

	_create_default_texture() {
		const gl = this.gl;
		const pixels = new Uint8Array([
			87, 175, 226, 255 // 0x57afe2 blue
		]);

		this.default_texture = new GLTexture(this.ctx);
		this.default_texture.set_rgba(pixels, 1, 1, { has_alpha: false });
	}

	async _load_textures() {
		const textures = this.m2.textures;

		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		for (let i = 0, n = textures.length; i < n; i++) {
			const texture = textures[i];
			const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;

			if (texture.fileDataID > 0) {
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, texture.fileDataID, this.syncID);

				try {
					const data = await texture.getTextureFile();
					const blp = new BLPFile(data);
					const gl_tex = new GLTexture(this.ctx);
					gl_tex.set_blp(blp, { flags: texture.flags });
					this.textures.set(i, gl_tex);

					if (ribbonSlot !== null)
						textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);
				} catch (e) {
					log.write('Failed to load texture %d: %s', texture.fileDataID, e.message);
				}
			}
		}
	}

	async loadSkin(index) {
		this._dispose_skin();

		const m2 = this.m2;
		const skin = await m2.getSkin(index);
		const gl = this.gl;

		// create skeleton
		await this._create_skeleton();

		// build interleaved vertex buffer
		// format: position(3f) + normal(3f) + bone_idx(4ub) + bone_weight(4ub) + uv(2f) + uv(2f) = 48 bytes
		const vertex_count = m2.vertices.length / 3;
		const stride = 48;
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

			// texcoord2
			vertex_view.setFloat32(offset + 40, m2.uv2[uv_idx], true);
			vertex_view.setFloat32(offset + 44, 1 - m2.uv2[uv_idx + 1], true);
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

		// set up vertex attributes
		vao.setup_m2_vertex_format();

		this.vaos.push(vao);

		this._create_bones_ubo();

		// reactive geoset array
		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

		// build draw calls per submesh
		this.draw_calls = [];

		for (let i = 0; i < skin.subMeshes.length; i++) {
			const submesh = skin.subMeshes[i];
			const tex_unit = skin.textureUnits.find(tu => tu.skinSectionIndex === i);

			let tex_indices = [null, null, null, null];
			let vertex_shader = 0;
			let pixel_shader = 0;
			let blend_mode = 0;
			let flags = 0;
			let texture_count = 1;
			let tex_mtx_idxs = [-1, -1];
			let prio = 0;
			let layer = 0;

			if (tex_unit) {
				texture_count = tex_unit.textureCount;
				prio = tex_unit.priority;
				layer = tex_unit.materialLayer;

				// get all texture indices for multi-texture shaders
				for (let j = 0; j < Math.min(texture_count, 4); j++) {
					const combo_idx = tex_unit.textureComboIndex + j;
					if (combo_idx < m2.textureCombos.length)
						tex_indices[j] = m2.textureCombos[combo_idx];
				}

				const vertex_shader_name = ShaderMapper.getVertexShader(tex_unit.textureCount, tex_unit.shaderID);
				vertex_shader = VERTEX_SHADER_IDS[vertex_shader_name] ?? 0;

				const pixel_shader_name = ShaderMapper.getPixelShader(tex_unit.textureCount, tex_unit.shaderID);
				pixel_shader = PIXEL_SHADER_IDS[pixel_shader_name] ?? 0;

				const mat = m2.materials[tex_unit.materialIndex];
				if (mat) {
					if (M2BLEND_TO_EGX.length > mat.blendingMode)
						blend_mode = M2BLEND_TO_EGX[mat.blendingMode];
					else
						blend_mode = mat.blendingMode;
					flags = mat.flags;

					this.material_props.set(tex_indices[0], { blendMode: blend_mode, flags: flags });
				}

				if (tex_unit.textureTransformComboIndex < m2.textureTransformsLookup.length) {
					const idx = m2.textureTransformsLookup[tex_unit.textureTransformComboIndex];
					if (idx < m2.textureTransforms.length)
						tex_mtx_idxs[0] = idx;
				}
				if (tex_unit.textureTransformComboIndex + 1 < m2.textureTransformsLookup.length) {
					const idx = m2.textureTransformsLookup[tex_unit.textureTransformComboIndex + 1];
					if (idx < m2.textureTransforms.length)
						tex_mtx_idxs[1] = idx;
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
				visible: true,
				tex_matrix_idxs: tex_mtx_idxs,
				prio: prio,
				layer: layer,
			};

			this.draw_calls.push(draw_call);

			// reactive geoset
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

	async _create_skeleton() {
		const m2 = this.m2;
		let bone_data = m2.bones;

		// load external skeleton if present
		if (m2.skeletonFileID) {
			try {
				const skel_file = await core.view.casc.getFile(m2.skeletonFileID);
				const skel = new SKELLoader(skel_file);
				await skel.load();

				if (skel.parent_skel_file_id > 0) {
					const parent_file = await core.view.casc.getFile(skel.parent_skel_file_id);
					const parent_skel = new SKELLoader(parent_file);
					await parent_skel.load();

					// track which animations come from child vs parent
					// child skeleton's .anim files have different data layouts than parent's bone offsets expect
					const child_anim_keys = new Set();
					if (skel.animFileIDs) {
						for (const entry of skel.animFileIDs) {
							if (entry.fileDataID > 0)
								child_anim_keys.add(`${entry.animID}-${entry.subAnimID}`);
						}
					}

					// store child skeleton for animations that need it
					if (child_anim_keys.size > 0) {
						this.childSkelLoader = skel;
						this.childAnimKeys = child_anim_keys;
					}

					// don't merge child AFIDs into parent - they use incompatible bone offsets
					// parent skeleton handles its own animations, child handles its own
					this.skelLoader = parent_skel;
					bone_data = parent_skel.bones;
				} else {
					this.skelLoader = skel;
					bone_data = skel.bones;
				}
			} catch (e) {
				log.write('Failed to load skeleton: %s', e.message);
			}
		}

		if (!bone_data || bone_data.length === 0) {
			this.bones = null;
			return;
		}

		this.bones = bone_data;

		// find HandsClosed animation (ID 15) for hand grip
		const anim_source = this.skelLoader || this.m2;
		if (anim_source.animations) {
			for (let i = 0; i < anim_source.animations.length; i++) {
				if (anim_source.animations[i].id === 15) {
					this.hands_closed_anim_idx = i;
					break;
				}
			}
		}
	}

	_create_bones_ubo() {
		this.shader.bind_uniform_block("VsBoneUbo", 0);
		const ubosize = this.shader.get_uniform_block_param("VsBoneUbo", this.gl.UNIFORM_BLOCK_DATA_SIZE);
		const offsets = this.shader.get_active_uniform_offsets(["u_bone_matrices"]);
		const ubo = new UniformBuffer(this.ctx, ubosize);
		this.ubos.push({
			ubo: ubo,
			offsets: offsets
		});

		this.bone_matrices = ubo.get_float32_view(offsets[0], (ubosize - offsets[0]) / 4);

		const bone_count = this.bones ? this.bones.length : 0;
		// initialize to identity
		for (let i = 0; i < bone_count; i++) {
			const offset = i * 16;
			this.bone_matrices.set(IDENTITY_MAT4, offset);
		}
	}

	_create_tex_matrices() {
		const m2 = this.m2;
		const tt = m2.textureTransforms;

		if (tt.length <= 0) {
			return;
		}

		this.tex_matrices = new Float32Array(tt.length * 16);
		for (let i = 0; i < tt.length; i++) {
			const offset = i * 16;
			this.tex_matrices.set(IDENTITY_MAT4, offset);
		}
	}

	/**
	 * Play animation by index
	 * @param {number} index
	 */
	async playAnimation(index) {
		let anim_source = this.skelLoader || this.m2;
		let anim_index = index;

		// check if this animation should come from child skeleton
		if (this.childSkelLoader && this.childAnimKeys && anim_source.animations?.[index]) {
			const anim = anim_source.animations[index];
			const key = `${anim.id}-${anim.variationIndex}`;
			if (this.childAnimKeys.has(key)) {
				// find the matching animation index in child skeleton
				const child_anims = this.childSkelLoader.animations;
				if (child_anims) {
					for (let i = 0; i < child_anims.length; i++) {
						if (child_anims[i].id === anim.id && child_anims[i].variationIndex === anim.variationIndex) {
							anim_source = this.childSkelLoader;
							anim_index = i;
							break;
						}
					}
				}
			}
		}

		// ensure animation data is loaded
		if (anim_source.loadAnimsForIndex)
			await anim_source.loadAnimsForIndex(anim_index);

		// store which skeleton is being used for this animation
		this.current_anim_source = anim_source;
		this.current_anim_index = anim_index;
		this.current_animation = index;
		this.animation_time = 0;
		this.global_seq_times = new Float32Array(anim_source.globalLoops.length);
	}

	stopAnimation() {
		this.animation_time = 0;
		this.animation_paused = false;
		this.global_seq_times.fill(0);

		// calculate bone matrices using animation 0 (stand) at time 0 for rest pose
		if (this.bones) {
			const prev_anim = this.current_animation;
			const prev_anim_idx = this.current_anim_index;
			const prev_source = this.current_anim_source;

			this.current_animation = 0;
			this.current_anim_index = 0;
			this.current_anim_source = this.skelLoader || this.m2;
			this._update_bone_matrices();
			this._update_tex_matrices();

			this.current_animation = null;
			this.current_anim_index = null;
			this.current_anim_source = null;
		}
	}

	/**
	 * @param {number} delta_time - time in seconds
	 */
	updateAnimation(delta_time) {
		if (this.current_animation === null || !this.bones)
			return;

		const anim_source = this.current_anim_source || this.skelLoader || this.m2;
		const anim_idx = this.current_anim_index ?? this.current_animation;
		const anim = anim_source.animations?.[anim_idx];
		if (!anim)
			return;

		if (!this.animation_paused) {
			this.animation_time += delta_time;

			for (let i = 0; i < this.global_seq_times.length; ++i) {
				this.global_seq_times[i] += (delta_time * 1000);
				let ts = anim_source.globalLoops[i];
				if (ts > 0) {
					this.global_seq_times[i] %= ts;
				}
			}
		}

		// wrap animation (duration is in milliseconds)
		const duration_sec = anim.duration / 1000;
		if (duration_sec > 0)
			this.animation_time = this.animation_time % duration_sec;

		// update bone matrices
		this._update_bone_matrices();
		this._update_tex_matrices();
	}

	get_animation_duration() {
		if (this.current_animation === null)
			return 0;

		const anim_source = this.current_anim_source || this.skelLoader || this.m2;
		const anim_idx = this.current_anim_index ?? this.current_animation;
		const anim = anim_source.animations?.[anim_idx];
		return anim ? anim.duration / 1000 : 0;
	}

	get_animation_frame_count() {
		const duration = this.get_animation_duration();
		// 60 fps
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
		this._update_tex_matrices();
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
		const time_ms = this.animation_time * 1000; // convert to milliseconds for raw tracks

		// use the correct skeleton's bones for animation data
		// child animations need child's bones which have correct offsets
		const anim_bones = this.current_anim_source?.bones || this.bones;
		const bones = this.bones; // structural bones for hierarchy/pivots
		const bone_count = bones.length;
		// use the correct animation index for the skeleton we're reading from
		const anim_idx = this.current_anim_index ?? this.current_animation;

		// hand grip: use HandsClosed animation for finger bones
		const hands_closed_idx = this.hands_closed_anim_idx;
		const close_r = this.close_right_hand && hands_closed_idx !== null;
		const close_l = this.close_left_hand && hands_closed_idx !== null;

		// temp matrices for bone calculation
		const local_mat = new Float32Array(16);
		const trans_mat = new Float32Array(16);
		const rot_mat = new Float32Array(16);
		const scale_mat = new Float32Array(16);
		const pivot_mat = new Float32Array(16);
		const neg_pivot_mat = new Float32Array(16);
		const temp_result = new Float32Array(16);

		// track which bones have been calculated
		const calculated = new Array(bone_count).fill(false);

		// recursive bone calculation using raw M2 bone data
		// applies: T(pivot) * T(anim) * R(anim) * S(anim) * T(-pivot)
		const calc_bone = (idx) => {
			if (calculated[idx])
				return;

			const bone = bones[idx];
			const anim_bone = anim_bones[idx]; // animation data may come from different skeleton
			const parent_idx = bone.parentBone;

			// calculate parent first
			if (parent_idx >= 0 && parent_idx < bone_count)
				calc_bone(parent_idx);

			// get pivot point (from structural bone)
			const pivot = bone.pivot;
			const px = pivot[0], py = pivot[1], pz = pivot[2];

			// determine which animation to use for this bone
			// finger bones use HandsClosed animation when hand grip is active
			// right finger bone IDs: 8-12, left finger bone IDs: 13-17
			const bone_id = bone.boneID;
			const is_right_finger = bone_id >= 8 && bone_id <= 12;
			const is_left_finger = bone_id >= 13 && bone_id <= 17;
			const use_closed_hand = (is_right_finger && close_r) || (is_left_finger && close_l);
			const effective_anim_idx = use_closed_hand ? hands_closed_idx : anim_idx;
			const effective_time_ms = use_closed_hand ? 0 : time_ms; // use frame 0 for HandsClosed

			// check if bone has any animation data for this animation (from anim_bone)
			const has_trans = anim_bone?.translation?.timestamps?.[effective_anim_idx]?.length > 0;
			const has_rot = anim_bone?.rotation?.timestamps?.[effective_anim_idx]?.length > 0;
			const has_scale = anim_bone?.scale?.timestamps?.[effective_anim_idx]?.length > 0;
			const has_scale_fallback = !has_scale && effective_anim_idx !== 0 && anim_bone?.scale?.timestamps?.[0]?.length > 0;
			const has_animation = has_trans || has_rot || has_scale || has_scale_fallback;

			// start with identity
			mat4_copy(local_mat, IDENTITY_MAT4);

			if (has_animation) {
				// translate to pivot
				mat4_from_translation(pivot_mat, px, py, pz);
				mat4_multiply(temp_result, local_mat, pivot_mat);
				mat4_copy(local_mat, temp_result);

				// apply translation (raw animation offset from anim_bone data)
				if (has_trans) {
					const ts = anim_bone.translation.timestamps[effective_anim_idx];
					const vals = anim_bone.translation.values[effective_anim_idx];
					const [tx, ty, tz] = this._sample_raw_vec3(ts, vals, effective_time_ms);

					mat4_from_translation(trans_mat, tx, ty, tz);
					mat4_multiply(temp_result, local_mat, trans_mat);
					mat4_copy(local_mat, temp_result);
				}

				// apply rotation
				if (has_rot) {
					const ts = anim_bone.rotation.timestamps[effective_anim_idx];
					const vals = anim_bone.rotation.values[effective_anim_idx];
					const [qx, qy, qz, qw] = this._sample_raw_quat(ts, vals, effective_time_ms);

					mat4_from_quat(rot_mat, qx, qy, qz, qw);
					mat4_multiply(temp_result, local_mat, rot_mat);
					mat4_copy(local_mat, temp_result);
				}

				// apply scale (fallback to animation 0 if current animation lacks scale data)
				if (has_scale || has_scale_fallback) {
					const scale_anim_idx = has_scale ? effective_anim_idx : 0;
					const ts = anim_bone.scale.timestamps[scale_anim_idx];
					const vals = anim_bone.scale.values[scale_anim_idx];
					const scale_time = has_scale ? effective_time_ms : 0;
					const [sx, sy, sz] = this._sample_raw_vec3(ts, vals, scale_time, [1, 1, 1]);

					mat4_from_scale(scale_mat, sx, sy, sz);
					mat4_multiply(temp_result, local_mat, scale_mat);
					mat4_copy(local_mat, temp_result);
				}

				// translate back from pivot
				mat4_from_translation(neg_pivot_mat, -px, -py, -pz);
				mat4_multiply(temp_result, local_mat, neg_pivot_mat);
				mat4_copy(local_mat, temp_result);
			}
			// if no animation, local_mat stays identity

			// multiply with parent matrix
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

		// calculate all bones
		for (let i = 0; i < bone_count; i++)
			calc_bone(i);
	}

	_find_time_index(currtime, times) {
		if (times.length > 1) {
			if (currtime > times[times.length - 1]) return times_len - 1;
			let lowerbound = (a, b) => { let n = a.length; for (let i=0;i<n;++i) {if (a[i] >= b) return i;} return n;};
			let time = lowerbound(times, currtime);
			if (time != 0) {
				time--;
			}
			return time;
		} else if (times.length == 1) {
			return 0;
		} else return -1;
	}

	_animate_track(anim, animblock, def, lerpfunc) {
		const m2 = this.m2;
		const gl = m2.globalLoops;
		let at = (this.animation_time * 1000);
		let ai = this.current_anim_index;
		let maxtime = anim.duration;

		const gs = animblock.globalSeq;
		if (gs >= 0) {
			at = this.global_seq_times[gs];
			maxtime = gl[gs];
		}

		if (animblock.timestamps.length == 0)
			return def;

		if (animblock.timestamps.length <= ai)
			ai = 0;

		if (ai <= animblock.timestamps[ai].length == 0)
			return def;

		const times = animblock.timestamps[ai];
		const values = animblock.values[ai];
		const intertype = animblock.interpolation;

		let ti = 0;
		if (maxtime != 0) {
			ti = this._find_time_index(at, times);
		}
		if (ti == times.size-1)
			return values[ti];
		else if (ti >= 0) {
			let v1 = values[ti];
			let v2 = values[ti + 1];
			let t1 = times[ti];
			let t2 = times[ti + 1];

			if (intertype == 0)
				return v1;
			else {
				return lerpfunc(v1, v2, (at - t1) / (t2 -t1));
			}
		} else {
			return values[0];
		}
	}

	_update_tex_matrices() {
		const anim_source = this.current_anim_source || this.skelLoader || this.m2;
		const anim_idx = this.current_anim_index ?? this.current_animation;
		const anim = anim_source.animations?.[anim_idx];
		if (!anim)
			return;

		const m2 = this.m2;
		const tm = this.tex_matrices;

		const temp_result = new Float32Array(16);

		for (let i = 0; i < m2.textureTransforms.length; ++i) {
			const tt = m2.textureTransforms[i];
			const local_mat = new Float32Array(16);
			mat4_copy(local_mat, IDENTITY_MAT4);

			const transmat = [0.5, 0.5, 0, 0];
			const pivotpoint = [-0.5, -0.5, 0, 0];

			if (tt.rotation.values.length) {
				const [qx, qy, qz, qw] = this._animate_track(anim, tt.rotation, [1,0,0,0], (a,b,c)=>{
					const out = [0, 0, 0, 1];
					quat_slerp(out, a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3], c);
					return out;
				});
				mat4_from_translation(temp_result, transmat[0], transmat[1], transmat[2]);
				mat4_multiply(local_mat, local_mat, temp_result);
				mat4_from_quat(temp_result, qx, qy, qz, qw);
				mat4_multiply(local_mat, local_mat, temp_result);
				mat4_from_translation(temp_result, pivotpoint[0], pivotpoint[1], pivotpoint[2]);
				mat4_multiply(local_mat, local_mat, temp_result);
			}
			if (tt.scaling.values.length) {
				const [qx, qy, qz, qw] = this._animate_track(anim, tt.scaling, [1,1,1,1], (a,b,c)=> {
					return [
						lerp(a[0], b[0], c),
						lerp(a[1], b[1], c),
						lerp(a[2], b[2], c),
						lerp(a[3], b[3], c),
					]
				});
				mat4_from_translation(temp_result, transmat[0], transmat[1], transmat[2]);
				mat4_multiply(local_mat, local_mat, temp_result);
				mat4_from_scale(temp_result, qx, qy, qz);
				mat4_multiply(local_mat, local_mat, temp_result);
				mat4_from_translation(temp_result, pivotpoint[0], pivotpoint[1], pivotpoint[2]);
				mat4_multiply(local_mat, local_mat, temp_result);
			}
			if (tt.translation.values.length) {
				const [qx, qy, qz, qw] = this._animate_track(anim, tt.translation, [0,0,0,0], (a,b,c)=> {
					return [
						lerp(a[0], b[0], c),
						lerp(a[1], b[1], c),
						lerp(a[2], b[2], c),
						lerp(a[3], b[3], c),
					]
				});
				mat4_from_translation(temp_result, qx, qy, qz);
				mat4_multiply(local_mat, local_mat, temp_result);
			}

			const offset = i * 16;
			tm.set(local_mat, offset);
		}
	}

	_sample_raw_vec3(timestamps, values, time_ms, default_value = [0, 0, 0]) {
		if (!timestamps || timestamps.length === 0)
			return default_value;

		if (timestamps.length === 1 || time_ms <= timestamps[0]) {
			const v = values[0];
			return [v[0], v[1], v[2]];
		}

		if (time_ms >= timestamps[timestamps.length - 1]) {
			const v = values[values.length - 1];
			return [v[0], v[1], v[2]];
		}

		// find keyframe
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

	_sample_raw_quat(timestamps, values, time_ms) {
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

		// find keyframe
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


	/**
	 * Build bone correspondence table by matching pivot positions and boneNameCRC
	 * @param {Array} char_bones - character model bone data
	 */
	buildBoneRemapTable(char_bones) {
		if (!this.bones || !char_bones) {
			this.bone_remap_table = null;
			return;
		}

		const epsilon = 0.0001;
		const remap = new Int16Array(this.bones.length);

		for (let i = 0; i < this.bones.length; i++) {
			const coll_bone = this.bones[i];
			const coll_pivot = coll_bone.pivot;
			let found = -1;

			// match by pivot position AND boneNameCRC (like wowmodelviewer)
			// boneNameCRC distinguishes left/right bones with similar pivots
			for (let j = 0; j < char_bones.length; j++) {
				const char_bone = char_bones[j];
				const char_pivot = char_bone.pivot;

				const dx = Math.abs(coll_pivot[0] - char_pivot[0]);
				const dy = Math.abs(coll_pivot[1] - char_pivot[1]);
				const dz = Math.abs(coll_pivot[2] - char_pivot[2]);

				if (dx < epsilon && dy < epsilon && dz < epsilon &&
					coll_bone.boneNameCRC === char_bone.boneNameCRC) {
					found = j;
					break;
				}
			}

			// fallback: match by pivot only if boneNameCRC match failed
			if (found < 0) {
				for (let j = 0; j < char_bones.length; j++) {
					const char_bone = char_bones[j];
					const char_pivot = char_bone.pivot;

					const dx = Math.abs(coll_pivot[0] - char_pivot[0]);
					const dy = Math.abs(coll_pivot[1] - char_pivot[1]);
					const dz = Math.abs(coll_pivot[2] - char_pivot[2]);

					if (dx < epsilon && dy < epsilon && dz < epsilon) {
						found = j;
						break;
					}
				}
			}

			remap[i] = found >= 0 ? found : i;
		}

		this.bone_remap_table = remap;
		this.use_external_bones = true;
	}

	/**
	 * Apply external bone matrices using the remap table
	 * @param {Float32Array} char_bone_matrices - character's bone matrices
	 */
	applyExternalBoneMatrices(char_bone_matrices) {
		if (!this.bone_remap_table || !this.bone_matrices || !char_bone_matrices)
			return;

		for (let i = 0; i < this.bone_remap_table.length; i++) {
			const char_idx = this.bone_remap_table[i];
			const char_offset = char_idx * 16;
			const local_offset = i * 16;

			if (char_offset + 16 <= char_bone_matrices.length)
				this.bone_matrices.set(char_bone_matrices.subarray(char_offset, char_offset + 16), local_offset);
		}
	}

	/**
	 * Set geoset visibility by group using attachmentGeosetGroup values
	 * Shows only geosets matching group*100 + value, hides others in range
	 * @param {number} group - geoset group (e.g., 18 for belt = 1800-1899)
	 * @param {number} value - specific geoset value (1 + attachmentGeosetGroup[n])
	 */
	setGeosetGroupDisplay(group, value) {
		if (!this.draw_calls || this.draw_calls.length === 0)
			return;

		const range_min = group * 100;
		const range_max = (group + 1) * 100;
		const target_id = range_min + value;

		// get skin submeshes to check geoset IDs
		const skin = this.m2?.skins?.[0];
		if (!skin?.subMeshes)
			return;

		for (let i = 0; i < this.draw_calls.length && i < skin.subMeshes.length; i++) {
			const submesh_id = skin.subMeshes[i].submeshID;

			// check if this submesh is in the geoset group range
			if (submesh_id > range_min && submesh_id < range_max)
				this.draw_calls[i].visible = (submesh_id === target_id);
		}
	}

	/**
	 * Hide all geosets (used before selectively showing collection geosets)
	 */
	hideAllGeosets() {
		for (const dc of this.draw_calls)
			dc.visible = false;
	}

	updateGeosets() {
		if (!this.reactive || !this.geosetArray || !this.draw_calls)
			return;

		for (let i = 0; i < this.draw_calls.length && i < this.geosetArray.length; i++)
			this.draw_calls[i].visible = this.geosetArray[i].checked;
	}

	updateWireframe() {
		// handled in render()
	}

	/**
	 * Set model transformation
	 * @param {number[]} position
	 * @param {number[]} rotation
	 * @param {number[]} scale
	 */
	setTransform(position, rotation, scale) {
		this.position = position;
		this.rotation = rotation;
		this.scale = scale;
		this._update_model_matrix();
	}

	/**
	 * Set model transformation using quaternion rotation
	 * @param {number[]} position - [x, y, z]
	 * @param {number[]} quat - [x, y, z, w]
	 * @param {number[]} scale - [x, y, z]
	 */
	setTransformQuat(position, quat, scale) {
		mat4_from_quat_trs(this.model_matrix, position, quat, scale);
	}

	/**
	 * Set model transformation using a pre-computed matrix
	 * @param {Float32Array} matrix - 4x4 column-major transform matrix
	 */
	setTransformMatrix(matrix) {
		this.model_matrix.set(matrix);
	}

	/**
	 * Set hand grip state for weapon attachment
	 * When closed, finger bones use HandsClosed animation
	 * @param {boolean} close_right - close right hand
	 * @param {boolean} close_left - close left hand
	 */
	setHandGrip(close_right, close_left) {
		this.close_right_hand = close_right;
		this.close_left_hand = close_left;
	}

	_update_model_matrix() {
		// build model matrix from position/rotation/scale (TRS order)
		const m = this.model_matrix;
		const [px, py, pz] = this.position;
		const [rx, ry, rz] = this.rotation;
		const [sx, sy, sz] = this.scale;

		// rotation (ZYX euler order, column-major)
		const cx = Math.cos(rx), sinx = Math.sin(rx);
		const cy = Math.cos(ry), siny = Math.sin(ry);
		const cz = Math.cos(rz), sinz = Math.sin(rz);

		// column 0 (scaled by sx)
		m[0] = cy * cz * sx;
		m[1] = cy * sinz * sx;
		m[2] = -siny * sx;
		m[3] = 0;

		// column 1 (scaled by sy)
		m[4] = (sinx * siny * cz - cx * sinz) * sy;
		m[5] = (sinx * siny * sinz + cx * cz) * sy;
		m[6] = sinx * cy * sy;
		m[7] = 0;

		// column 2 (scaled by sz)
		m[8] = (cx * siny * cz + sinx * sinz) * sz;
		m[9] = (cx * siny * sinz - sinx * cz) * sz;
		m[10] = cx * cy * sz;
		m[11] = 0;

		// column 3 (translation)
		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	/**
	 * Render the model
	 * @param {Float32Array} view_matrix
	 * @param {Float32Array} projection_matrix
	 */
	render(view_matrix, projection_matrix) {
		if (!this.shader || this.draw_calls.length === 0)
			return;

		const gl = this.gl;
		const ctx = this.ctx;
		const shader = this.shader;
		const wireframe = core.view.config.modelViewerWireframe;

		shader.use();

		// set scene uniforms
		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);
		shader.set_uniform_3f('u_view_up', 0, 1, 0);
		shader.set_uniform_1f('u_time', performance.now() * 0.001);

		const ubo = this.ubos[0];
		const bone_count = this.bones ? this.bones.length : 0;
		shader.set_uniform_1i('u_bone_count', bone_count);
		if (bone_count)
			ubo.ubo.upload_range(ubo.offsets[0], bone_count * 16 * 4);

		// lighting - transform light direction to view space
		const lx = 3, ly = -0.7, lz = -2;
		const light_view_x = view_matrix[0] * lx + view_matrix[4] * ly + view_matrix[8] * lz;
		const light_view_y = view_matrix[1] * lx + view_matrix[5] * ly + view_matrix[9] * lz;
		const light_view_z = view_matrix[2] * lx + view_matrix[6] * ly + view_matrix[10] * lz;

		shader.set_uniform_1i('u_apply_lighting', 1);
		shader.set_uniform_3f('u_ambient_color', 0.5, 0.5, 0.5);
		shader.set_uniform_3f('u_diffuse_color', 0.7, 0.7, 0.7);
		shader.set_uniform_3f('u_light_dir', light_view_x, light_view_y, light_view_z);

		// wireframe
		shader.set_uniform_1i('u_wireframe', wireframe ? 1 : 0);
		shader.set_uniform_4f('u_wireframe_color', 1, 1, 1, 1);

		// alpha test
		shader.set_uniform_1f('u_alpha_test', 0.501960814);

		// texture samplers
		shader.set_uniform_1i('u_texture1', 0);
		shader.set_uniform_1i('u_texture2', 1);
		shader.set_uniform_1i('u_texture3', 2);
		shader.set_uniform_1i('u_texture4', 3);

		// default texture weights
		shader.set_uniform_3f('u_tex_sample_alpha', 1, 1, 1);

		const sorted_calls = [...this.draw_calls].sort((a, b) => {
			if (a.prio != b.prio)
				return a.prio - b.prio;
			if (a.layer != b.layer)
				return a.layer - b.layer;
			if (a.blend_mode != b.blend_mode)
				return a.blend_mode - b.blend_mode;

			return 0;
		});

		// render each draw call
		for (const dc of sorted_calls) {
			if (!dc.visible)
				continue;

			// set material uniforms
			shader.set_uniform_1i('u_vertex_shader', dc.vertex_shader);
			shader.set_uniform_1i('u_pixel_shader', dc.pixel_shader);
			shader.set_uniform_1i('u_blend_mode', dc.blend_mode);

			const tmi0 = dc.tex_matrix_idxs[0];
			const tmi1 = dc.tex_matrix_idxs[1];

			const get_tex_matrix = (idx) => {
				return this.tex_matrices.subarray(idx * 16, (idx + 1) * 16);
			}

			shader.set_uniform_mat4('u_tex_matrix1', false, tmi0 == -1 ? IDENTITY_MAT4 : get_tex_matrix(tmi0));
			shader.set_uniform_mat4('u_tex_matrix2', false, tmi1 == -1 ? IDENTITY_MAT4 : get_tex_matrix(tmi1));

			// mesh color (white for now)
			shader.set_uniform_4f('u_mesh_color', 1, 1, 1, 1);

			// apply blend mode
			ctx.apply_blend_mode(dc.blend_mode);

			// culling based on flags
			if (dc.flags & 0x04) {
				ctx.set_cull_face(false);
			} else {
				ctx.set_cull_face(true);
				ctx.set_cull_mode(gl.BACK);
			}

			// depth test flags
			if (dc.flags & 0x08)
				ctx.set_depth_test(false);
			else
				ctx.set_depth_test(true);

			if (dc.flags & 0x10)
				ctx.set_depth_write(false);
			else
				ctx.set_depth_write(true);

			// bind textures (up to 4 for multi-texture shaders)
			for (let t = 0; t < 4; t++) {
				const tex_idx = dc.tex_indices[t];
				const texture = (tex_idx !== null) ? (this.textures.get(tex_idx) || this.default_texture) : this.default_texture;
				texture.bind(t);
			}

			// draw
			ubo.ubo.bind(0);
			dc.vao.bind();
			gl.drawElements(
				wireframe ? gl.LINES : gl.TRIANGLES,
				dc.count,
				gl.UNSIGNED_SHORT,
				dc.start * 2
			);
		}

		// reset state
		ctx.set_blend(false);
		ctx.set_depth_test(true);
		ctx.set_depth_write(true);
		ctx.set_cull_face(false);
	}

	/**
	 * Override texture by type
	 * @param {number} type
	 * @param {number} fileDataID
	 */
	async overrideTextureType(type, fileDataID) {
		const textureTypes = this.m2.textureTypes;

		for (let i = 0; i < textureTypes.length; i++) {
			if (textureTypes[i] !== type)
				continue;

			try {
				const data = await core.view.casc.getFile(fileDataID);
				const blp = new BLPFile(data);
				const gl_tex = new GLTexture(this.ctx);
				gl_tex.set_blp(blp, { flags: this.m2.textures[i].flags });

				// dispose old texture
				const old = this.textures.get(i);
				if (old)
					old.dispose();

				this.textures.set(i, gl_tex);

				if (this.useRibbon) {
					textureRibbon.setSlotFile(i, fileDataID, this.syncID);
					textureRibbon.setSlotSrc(i, blp.getDataURL(0b0111), this.syncID);
				}
			} catch (e) {
				log.write('Failed to override texture: %s', e.message);
			}
		}
	}

	/**
	 * Override texture with canvas
	 * @param {number} type
	 * @param {HTMLCanvasElement} canvas
	 */
	async overrideTextureTypeWithCanvas(type, canvas) {
		const textureTypes = this.m2.textureTypes;

		for (let i = 0; i < textureTypes.length; i++) {
			if (textureTypes[i] !== type)
				continue;

			const gl_tex = new GLTexture(this.ctx);
			gl_tex.set_canvas(canvas, {
				wrap_s: (this.m2.textures[i].flags & 0x1) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE,
				wrap_t: (this.m2.textures[i].flags & 0x2) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE
			});

			const old = this.textures.get(i);
			if (old)
				old.dispose();

			this.textures.set(i, gl_tex);
		}
	}

	/**
	 * Override texture with pixel data
	 * @param {number} type
	 * @param {number} width
	 * @param {number} height
	 * @param {Uint8Array} pixels
	 */
	async overrideTextureTypeWithPixels(type, width, height, pixels) {
		const textureTypes = this.m2.textureTypes;

		for (let i = 0; i < textureTypes.length; i++) {
			if (textureTypes[i] !== type)
				continue;

			const gl_tex = new GLTexture(this.ctx);
			gl_tex.set_rgba(pixels, width, height, {
				wrap_s: (this.m2.textures[i].flags & 0x1) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE,
				wrap_t: (this.m2.textures[i].flags & 0x2) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE
			});

			const old = this.textures.get(i);
			if (old)
				old.dispose();

			this.textures.set(i, gl_tex);
		}
	}

	/**
	 * Apply replaceable textures
	 * @param {object} displays
	 */
	async applyReplaceableTextures(displays) {
		for (let i = 0; i < this.m2.textureTypes.length; i++) {
			const textureType = this.m2.textureTypes[i];
			if (textureType >= 11 && textureType < 14)
				await this.overrideTextureType(textureType, displays.textures[textureType - 11]);
			else if (textureType > 1 && textureType < 5)
				await this.overrideTextureType(textureType, displays.textures[textureType - 2]);
		}
	}

	/**
	 * Get UV layer data
	 */
	getUVLayers() {
		if (!this.m2)
			return { layers: [], indices: null };

		return {
			layers: [
				{ name: 'UV1', data: new Float32Array(this.m2.uv), active: false }
			],
			indices: null
		};
	}

	/**
	 * Get posed geometry with current bone transforms applied
	 * @returns {{ vertices: Float32Array, normals: Float32Array } | null}
	 */
	getBakedGeometry() {
		if (!this.m2)
			return null;

		const m2 = this.m2;
		const src_verts = m2.vertices;
		const src_normals = m2.normals;
		const bone_indices = m2.boneIndices;
		const bone_weights = m2.boneWeights;

		const vertex_count = src_verts.length / 3;
		const out_verts = new Float32Array(vertex_count * 3);
		const out_normals = new Float32Array(vertex_count * 3);

		// no bones or no animation - return original geometry
		if (!this.bones || !this.bone_matrices || this.current_animation === null) {
			out_verts.set(src_verts);
			out_normals.set(src_normals);
			return { vertices: out_verts, normals: out_normals };
		}

		// apply bone transforms to each vertex
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
				const m = this.bone_matrices;

				// transform position: out = mat * vec4(v, 1)
				const tx = m[mat_offset + 0] * vx + m[mat_offset + 4] * vy + m[mat_offset + 8] * vz + m[mat_offset + 12];
				const ty = m[mat_offset + 1] * vx + m[mat_offset + 5] * vy + m[mat_offset + 9] * vz + m[mat_offset + 13];
				const tz = m[mat_offset + 2] * vx + m[mat_offset + 6] * vy + m[mat_offset + 10] * vz + m[mat_offset + 14];

				out_x += tx * weight;
				out_y += ty * weight;
				out_z += tz * weight;

				// transform normal: out = mat3(mat) * normal (no translation)
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
	 * Get world transform matrix for an attachment point.
	 * Combines bone transform with attachment local offset.
	 * @param {number} attachmentId - attachment ID (e.g., 11 for helmet)
	 * @returns {Float32Array|null} - 4x4 transform matrix or null if not found
	 */
	getAttachmentTransform(attachmentId) {
		if (!this.m2)
			return null;

		// try m2 first, then skelLoader (modern character models use .skel files)
		let attachment = this.m2.getAttachmentById(attachmentId);
		if (!attachment && this.skelLoader?.getAttachmentById)
			attachment = this.skelLoader.getAttachmentById(attachmentId);

		if (!attachment)
			return null;

		const bone_idx = attachment.bone;
		if (bone_idx < 0 || !this.bone_matrices)
			return null;

		// get bone world matrix (includes rotation from animation)
		const bone_offset = bone_idx * 16;
		const bone_mat = this.bone_matrices.subarray(bone_offset, bone_offset + 16);

		// attachment position is in WoW coords (X=right, Y=forward, Z=up)
		// convert to WebGL coords (X=right, Y=up, Z=-forward)
		const pos = attachment.position;
		const att_x = pos[0];
		const att_y = pos[2];  // WoW Z -> WebGL Y
		const att_z = -pos[1]; // WoW Y -> WebGL -Z

		// create attachment local transform (translation only)
		const att_mat = new Float32Array([
			1, 0, 0, 0,
			0, 1, 0, 0,
			0, 0, 1, 0,
			att_x, att_y, att_z, 1
		]);

		// combine: world = bone_world * attachment_local
		const result = new Float32Array(16);
		mat4_multiply(result, bone_mat, att_mat);

		// apply character model's transform (rotation from camera controls)
		mat4_multiply(result, this.model_matrix, result);

		return result;
	}

	/**
	 * Get model bounding box (converted from WoW Z-up to WebGL Y-up)
	 * @returns {{ min: number[], max: number[] } | null}
	 */
	getBoundingBox() {
		if (!this.m2 || !this.m2.boundingBox)
			return null;

		const src_min = this.m2.boundingBox.min;
		const src_max = this.m2.boundingBox.max;

		// wow coords: X=right, Y=forward, Z=up
		// webgl coords: X=right, Y=up, Z=forward (negated)
		return {
			min: [src_min[0], src_min[2], -src_max[1]],
			max: [src_max[0], src_max[2], -src_min[1]]
		};
	}

	_dispose_skin() {
		// vao.dispose() handles vbo/ebo deletion
		for (const vao of this.vaos)
			vao.dispose();
		for (const ubo of this.ubos)
			ubo.ubo.dispose();

		this.ubos = [];
		this.vaos = [];
		this.buffers = [];
		this.draw_calls = [];

		if (this.geosetArray)
			this.geosetArray.splice(0);
	}

	dispose() {
		// unregister watchers
		this.geosetWatcher?.();
		this.wireframeWatcher?.();
		this.bonesWatcher?.();

		this._dispose_skin();

		// dispose textures
		for (const tex of this.textures.values())
			tex.dispose();

		this.textures.clear();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}
	}
}

module.exports = M2RendererGL;
