/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/



import ShaderProgram from '../gl/ShaderProgram.js';

const SHADOW_VERT_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;

uniform mat4 u_view_matrix;
uniform mat4 u_projection_matrix;

out vec2 v_uv;

void main() {
	gl_Position = u_projection_matrix * u_view_matrix * vec4(a_position, 1.0);
	v_uv = a_uv;
}
`;

const SHADOW_FRAG_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 frag_color;

uniform float u_shadow_radius;

void main() {
	vec2 center = vec2(0.5, 0.5);
	float dist = distance(v_uv, center) * 2.0;
	float alpha = smoothstep(1.0, 0.0, dist / (u_shadow_radius / 10.0));
	frag_color = vec4(0.0, 0.0, 0.0, alpha * 0.6);
}
`;

class ShadowPlaneRenderer {
	/**
	 * @param {GLContext} gl_context
	 * @param {number} size - size of the shadow plane
	 */
	constructor(gl_context, size = 2) {
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.size = size;
		this.shadow_radius = 8.0;
		this.visible = true;

		this.shader = null;
		this.vao = null;
		this.vertex_buffer = null;
		this.index_buffer = null;

		this._init();
	}

	_init() {
		this._create_shader();
		this._create_geometry();
	}

	_create_shader() {
		this.shader = new ShaderProgram(this.ctx, SHADOW_VERT_SHADER, SHADOW_FRAG_SHADER);
	}

	_create_geometry() {
		const gl = this.gl;
		const half = this.size / 2;

		// quad vertices: position (xyz) + uv (st)
		const vertices = new Float32Array([
			-half, 0, -half, 0, 0,
			 half, 0, -half, 1, 0,
			 half, 0,  half, 1, 1,
			-half, 0,  half, 0, 1
		]);

		const indices = new Uint16Array([
			0, 1, 2,
			0, 2, 3
		]);

		// create VAO
		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);

		// vertex buffer
		this.vertex_buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

		// index buffer
		this.index_buffer = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		// position attribute (location 0)
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

		// uv attribute (location 1)
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);

		gl.bindVertexArray(null);
	}

	/**
	 * @param {Float32Array} view_matrix
	 * @param {Float32Array} projection_matrix
	 */
	render(view_matrix, projection_matrix) {
		if (!this.visible || !this.shader || !this.shader.is_valid())
			return;

		const gl = this.gl;

		// enable blending for transparency
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(false);

		this.shader.use();
		this.shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		this.shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		this.shader.set_uniform_1f('u_shadow_radius', this.shadow_radius);

		this.ctx.bind_vao(this.vao);
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

		// restore state
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	dispose() {
		const gl = this.gl;

		if (this.vao) {
			gl.deleteVertexArray(this.vao);
			this.vao = null;
		}

		if (this.vertex_buffer) {
			gl.deleteBuffer(this.vertex_buffer);
			this.vertex_buffer = null;
		}

		if (this.index_buffer) {
			gl.deleteBuffer(this.index_buffer);
			this.index_buffer = null;
		}

		if (this.shader) {
			this.shader.dispose();
			this.shader = null;
		}
	}
}

export default ShadowPlaneRenderer;