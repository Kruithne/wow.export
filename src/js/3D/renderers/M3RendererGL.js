/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../../core');
const log = require('../../log');

const M3Loader = require('../loaders/M3Loader');
const Shaders = require('../Shaders');

const GLContext = require('../gl/GLContext');
const VertexArray = require('../gl/VertexArray');
const GLTexture = require('../gl/GLTexture');

const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

class M3RendererGL {
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

		this.m3 = null;

		// rendering state
		this.vaos = [];
		this.buffers = [];
		this.draw_calls = [];
		this.default_texture = null;

		// transforms
		this.model_matrix = new Float32Array(IDENTITY_MAT4);
	}

	/**
	 * Load shader program
	 */
	static load_shaders(ctx) {
		return Shaders.create_program(ctx, 'm2');
	}

	async load() {
		this.m3 = new M3Loader(this.data);
		await this.m3.load();

		this.shader = M3RendererGL.load_shaders(this.ctx);

		this._create_default_texture();

		if (this.m3.vertices && this.m3.vertices.length > 0)
			await this.loadLOD(0);

		this.data = undefined;
	}

	_create_default_texture() {
		const pixels = new Uint8Array([87, 175, 226, 255]); // 0x57afe2 blue
		this.default_texture = new GLTexture(this.ctx);
		this.default_texture.set_rgba(pixels, 1, 1, { has_alpha: false });
	}

	async loadLOD(index) {
		this._dispose_geometry();

		const m3 = this.m3;
		const gl = this.gl;

		// build interleaved vertex buffer
		// format: position(3f) + normal(3f) + uv(2f) = 32 bytes (no bones for M3)
		const vertex_count = m3.vertices.length / 3;
		const stride = 32;
		const vertex_data = new ArrayBuffer(vertex_count * stride);
		const vertex_view = new DataView(vertex_data);

		for (let i = 0; i < vertex_count; i++) {
			const offset = i * stride;
			const v_idx = i * 3;
			const uv_idx = i * 2;

			// position
			vertex_view.setFloat32(offset + 0, m3.vertices[v_idx], true);
			vertex_view.setFloat32(offset + 4, m3.vertices[v_idx + 1], true);
			vertex_view.setFloat32(offset + 8, m3.vertices[v_idx + 2], true);

			// normal
			vertex_view.setFloat32(offset + 12, m3.normals ? m3.normals[v_idx] : 0, true);
			vertex_view.setFloat32(offset + 16, m3.normals ? m3.normals[v_idx + 1] : 1, true);
			vertex_view.setFloat32(offset + 20, m3.normals ? m3.normals[v_idx + 2] : 0, true);

			// texcoord
			vertex_view.setFloat32(offset + 24, m3.uv ? m3.uv[uv_idx] : 0, true);
			vertex_view.setFloat32(offset + 28, m3.uv ? m3.uv[uv_idx + 1] : 0, true);
		}

		// create VAO
		const vao = new VertexArray(this.ctx);
		vao.bind();

		const vbo = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, vertex_data, gl.STATIC_DRAW);
		this.buffers.push(vbo);
		vao.vbo = vbo;

		// setup vertex attributes (simplified - no bone data)
		// a_position: location 0, 3 floats
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);

		// a_normal: location 1, 3 floats
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);

		// a_bone_indices: location 2, 4 ubytes (dummy - all zeros)
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, false, stride, 0); // point to position as dummy
		gl.vertexAttrib4f(2, 0, 0, 0, 0);
		gl.disableVertexAttribArray(2);

		// a_bone_weights: location 3, 4 ubytes (dummy - all zeros)
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, stride, 0);
		gl.vertexAttrib4f(3, 0, 0, 0, 0);
		gl.disableVertexAttribArray(3);

		// a_texcoord: location 4, 2 floats
		gl.enableVertexAttribArray(4);
		gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 24);

		this.vaos.push(vao);

		// build draw calls per geoset for specified LOD
		this.draw_calls = [];

		for (let lod_idx = 0; lod_idx < m3.lodLevels.length; lod_idx++) {
			if (lod_idx !== index)
				continue;

			for (let geo_idx = m3.geosetCountPerLOD * lod_idx; geo_idx < m3.geosetCountPerLOD * (lod_idx + 1); geo_idx++) {
				const geoset = m3.geosets[geo_idx];

				// create index buffer for this geoset
				const indices = new Uint16Array(m3.indices.slice(geoset.indexStart, geoset.indexStart + geoset.indexCount));
				const ebo = gl.createBuffer();
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
				this.buffers.push(ebo);

				this.draw_calls.push({
					vao: vao,
					ebo: ebo,
					count: geoset.indexCount,
					visible: true
				});
			}
		}
	}

	updateGeosets() {
		// no geoset management for M3
	}

	updateWireframe() {
		// handled in render()
	}

	/**
	 * Get model bounding box
	 * @returns {{ min: number[], max: number[] } | null}
	 */
	getBoundingBox() {
		if (!this.m3 || !this.m3.vertices)
			return null;

		const verts = this.m3.vertices;
		const min = [Infinity, Infinity, Infinity];
		const max = [-Infinity, -Infinity, -Infinity];

		for (let i = 0; i < verts.length; i += 3) {
			min[0] = Math.min(min[0], verts[i]);
			min[1] = Math.min(min[1], verts[i + 1]);
			min[2] = Math.min(min[2], verts[i + 2]);
			max[0] = Math.max(max[0], verts[i]);
			max[1] = Math.max(max[1], verts[i + 1]);
			max[2] = Math.max(max[2], verts[i + 2]);
		}

		return { min, max };
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

		// scene uniforms
		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);
		shader.set_uniform_3f('u_view_up', 0, 1, 0);
		shader.set_uniform_1f('u_time', performance.now() * 0.001);

		// no bones
		shader.set_uniform_1i('u_bone_count', 0);

		// texture matrix defaults
		shader.set_uniform_1i('u_has_tex_matrix1', 0);
		shader.set_uniform_1i('u_has_tex_matrix2', 0);
		shader.set_uniform_mat4('u_tex_matrix1', false, IDENTITY_MAT4);
		shader.set_uniform_mat4('u_tex_matrix2', false, IDENTITY_MAT4);

		// lighting
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

		// material settings (opaque)
		shader.set_uniform_1i('u_vertex_shader', 0);
		shader.set_uniform_1i('u_pixel_shader', 0);
		shader.set_uniform_1i('u_blend_mode', 0);
		shader.set_uniform_4f('u_mesh_color', 1, 1, 1, 1);
		shader.set_uniform_3f('u_tex_sample_alpha', 1, 1, 1);

		// bind default texture
		this.default_texture.bind(0);
		this.default_texture.bind(1);
		this.default_texture.bind(2);
		this.default_texture.bind(3);

		ctx.set_blend(false);
		ctx.set_depth_test(true);
		ctx.set_cull_face(false);

		// render each draw call
		for (const dc of this.draw_calls) {
			if (!dc.visible)
				continue;

			dc.vao.bind();
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dc.ebo);
			gl.drawElements(
				wireframe ? gl.LINES : gl.TRIANGLES,
				dc.count,
				gl.UNSIGNED_SHORT,
				0
			);
		}

		ctx.set_cull_face(false);
	}

	_dispose_geometry() {
		for (const vao of this.vaos)
			vao.dispose();

		for (const buf of this.buffers)
			this.gl.deleteBuffer(buf);

		this.vaos = [];
		this.buffers = [];
		this.draw_calls = [];
	}

	dispose() {
		this._dispose_geometry();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}
	}
}

module.exports = M3RendererGL;
