/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const fs = require('fs');
const path = require('path');
const core = require('../../core');
const log = require('../../log');
const constants = require('../../constants');

const BLPFile = require('../../casc/blp');
const M2Loader = require('../loaders/M2Loader');
const SKELLoader = require('../loaders/SKELLoader');
const GeosetMapper = require('../GeosetMapper');
const ShaderMapper = require('../ShaderMapper');
const M2AnimationConverter = require('../M2AnimationConverter');

const GLContext = require('../gl/GLContext');
const ShaderProgram = require('../gl/ShaderProgram');
const VertexArray = require('../gl/VertexArray');
const GLTexture = require('../gl/GLTexture');

const textureRibbon = require('../../ui/texture-ribbon');

const DEFAULT_MODEL_COLOR = [0.34, 0.68, 0.89]; // 0x57afe2

// identity matrix
const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

let _shader_cache = null;

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
		this.textures = new Map();
		this.default_texture = null;
		this.buffers = [];
		this.draw_calls = [];

		// animation state
		this.bones = null;
		this.bone_matrices = null;
		this.animation_clips = new Map();
		this.current_animation = null;
		this.animation_time = 0;

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
	 * Load shader program (cached)
	 */
	static async load_shaders(ctx) {
		if (_shader_cache)
			return _shader_cache;

		const shader_path = constants.SHADER_PATH;
		const vert_source = fs.readFileSync(path.join(shader_path, 'm2.vertex.shader'), 'utf8');
		const frag_source = fs.readFileSync(path.join(shader_path, 'm2.fragment.shader'), 'utf8');

		const program = new ShaderProgram(ctx, vert_source, frag_source);
		if (!program.is_valid())
			throw new Error('Failed to compile M2 shader');

		_shader_cache = program;
		return program;
	}

	async load() {
		// parse M2 data
		this.m2 = new M2Loader(this.data);
		await this.m2.load();

		// load shader program
		this.shader = await M2RendererGL.load_shaders(this.ctx);

		// create default texture
		this._create_default_texture();

		// load textures
		await this._load_textures();

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

		// set up vertex attributes
		vao.setup_m2_vertex_format();

		this.vaos.push(vao);

		// reactive geoset array
		if (this.reactive)
			this.geosetArray = new Array(skin.subMeshes.length);

		// build draw calls per submesh
		this.draw_calls = [];

		for (let i = 0; i < skin.subMeshes.length; i++) {
			const submesh = skin.subMeshes[i];
			const tex_unit = skin.textureUnits.find(tu => tu.skinSectionIndex === i);

			let tex_index = null;
			let vertex_shader = 0;
			let pixel_shader = 0;
			let blend_mode = 0;
			let flags = 0;

			if (tex_unit) {
				tex_index = m2.textureCombos[tex_unit.textureComboIndex];

				const shaders = ShaderMapper.getVertexShader(tex_unit.textureCount, tex_unit.shaderID);
				vertex_shader = typeof shaders === 'object' ? 0 : shaders;
				pixel_shader = ShaderMapper.getPixelShader(tex_unit.textureCount, tex_unit.shaderID);

				const mat = m2.materials[tex_unit.materialIndex];
				if (mat) {
					blend_mode = mat.blendingMode;
					flags = mat.flags;

					this.material_props.set(tex_index, { blendMode: blend_mode, flags: flags });
				}
			}

			const draw_call = {
				vao: vao,
				start: submesh.triangleStart,
				count: submesh.triangleCount,
				tex_index: tex_index,
				vertex_shader: vertex_shader,
				pixel_shader: pixel_shader,
				blend_mode: blend_mode,
				flags: flags,
				visible: true
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
					await parent_skel.loadAnims(false);
					this.skelLoader = parent_skel;
					bone_data = parent_skel.bones;
				} else {
					await skel.loadAnims(false);
					this.skelLoader = skel;
					bone_data = skel.bones;
				}
			} catch (e) {
				log.write('Failed to load skeleton: %s', e.message);
			}
		}

		if (!bone_data || bone_data.length === 0) {
			this.bones = null;
			this.bone_matrices = new Float32Array(16); // single identity
			return;
		}

		this.bones = bone_data;
		this.bone_matrices = new Float32Array(bone_data.length * 16);

		// initialize to identity
		for (let i = 0; i < bone_data.length; i++) {
			const offset = i * 16;
			this.bone_matrices.set(IDENTITY_MAT4, offset);
		}
	}

	/**
	 * Play animation by index
	 * @param {number} index
	 */
	async playAnimation(index) {
		// load animation if not cached
		if (!this.animation_clips.has(index)) {
			const anim_source = this.skelLoader || this.m2;
			const clip = await M2AnimationConverter.convertAnimation(anim_source, index, true);

			if (clip) {
				this.animation_clips.set(index, clip);
			} else {
				log.write('Failed to convert animation %d', index);
				return;
			}
		}

		this.current_animation = index;
		this.animation_time = 0;
	}

	stopAnimation() {
		this.current_animation = null;
		this.animation_time = 0;

		// reset bone matrices
		if (this.bones) {
			for (let i = 0; i < this.bones.length; i++)
				this.bone_matrices.set(IDENTITY_MAT4, i * 16);
		}
	}

	/**
	 * @param {number} delta_time - time in seconds
	 */
	updateAnimation(delta_time) {
		if (this.current_animation === null || !this.bones)
			return;

		const clip = this.animation_clips.get(this.current_animation);
		if (!clip)
			return;

		this.animation_time += delta_time;

		// wrap animation
		if (clip.duration > 0)
			this.animation_time = this.animation_time % clip.duration;

		// update bone matrices from animation tracks
		this._update_bone_matrices(clip);
	}

	_update_bone_matrices(clip) {
		// simple implementation - evaluate each bone track
		const time = this.animation_time;

		for (const track of clip.tracks) {
			// extract bone index from track name
			const match = track.name.match(/bone_(?:idx_)?(\d+)/);
			if (!match)
				continue;

			const bone_idx = parseInt(match[1]);
			if (bone_idx >= this.bones.length)
				continue;

			// find keyframe
			const times = track.times;
			const values = track.values;
			let frame = 0;

			for (let i = 0; i < times.length - 1; i++) {
				if (time >= times[i] && time < times[i + 1]) {
					frame = i;
					break;
				}
			}

			// for now, just snap to keyframe
			// todo: interpolation
			const offset = bone_idx * 16;

			if (track.name.endsWith('.position')) {
				const v_idx = frame * 3;
				// translation goes into column 3
				this.bone_matrices[offset + 12] = values[v_idx];
				this.bone_matrices[offset + 13] = values[v_idx + 1];
				this.bone_matrices[offset + 14] = values[v_idx + 2];
			}
		}
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

		// bone matrices
		shader.set_uniform_1i('u_bone_count', this.bones ? this.bones.length : 0);
		if (this.bones && this.bone_matrices) {
			const loc = shader.get_uniform_location('u_bone_matrices');
			if (loc !== null)
				gl.uniformMatrix4fv(loc, false, this.bone_matrices);
		}

		// texture matrix defaults
		shader.set_uniform_1i('u_has_tex_matrix1', 0);
		shader.set_uniform_1i('u_has_tex_matrix2', 0);
		shader.set_uniform_mat4('u_tex_matrix1', false, IDENTITY_MAT4);
		shader.set_uniform_mat4('u_tex_matrix2', false, IDENTITY_MAT4);

		// lighting - transform light direction to view space
		const lx = 0.5, ly = -0.7, lz = 0.5;
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

		// sort draw calls by blend mode (opaque first, then transparent)
		const sorted_calls = [...this.draw_calls].sort((a, b) => {
			const a_opaque = a.blend_mode === 0 || a.blend_mode === 1;
			const b_opaque = b.blend_mode === 0 || b.blend_mode === 1;
			if (a_opaque !== b_opaque)
				return a_opaque ? -1 : 1;

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

			// bind texture
			const texture = this.textures.get(dc.tex_index) || this.default_texture;
			texture.bind(0);

			// bind additional textures (for multi-texture shaders)
			this.default_texture.bind(1);
			this.default_texture.bind(2);
			this.default_texture.bind(3);

			// draw
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

		this.animation_clips.clear();
	}
}

module.exports = M2RendererGL;
