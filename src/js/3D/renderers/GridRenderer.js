/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const ShaderProgram = require('../gl/ShaderProgram');

const GRID_VERT_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_color;

uniform mat4 u_view_matrix;
uniform mat4 u_projection_matrix;

out vec3 v_color;

void main() {
	gl_Position = u_projection_matrix * u_view_matrix * vec4(a_position, 1.0);
	v_color = a_color;
}
`;

const GRID_FRAG_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
out vec4 frag_color;

void main() {
	frag_color = vec4(v_color, 1.0);
}
`;

// grid colors (matching Three.js GridHelper defaults)
const CENTER_COLOR = [0.34, 0.68, 0.89]; // 0x57afe2
const LINE_COLOR = [0.5, 0.5, 0.5];       // 0x808080

class GridRenderer {
	/**
	 * @param {GLContext} gl_context
	 * @param {number} size - total size of the grid
	 * @param {number} divisions - number of divisions
	 */
	constructor(gl_context, size = 100, divisions = 100) {
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.size = size;
		this.divisions = divisions;

		this.shader = null;
		this.vao = null;
		this.vertex_buffer = null;
		this.vertex_count = 0;

		this._init();
	}

	_init() {
		this._create_shader();
		this._create_geometry();
	}

	_create_shader() {
		this.shader = new ShaderProgram(this.ctx, GRID_VERT_SHADER, GRID_FRAG_SHADER);
	}

	_create_geometry() {
		const gl = this.gl;
		const half = this.size / 2;
		const step = this.size / this.divisions;

		const vertices = [];

		// generate grid lines
		for (let i = 0; i <= this.divisions; i++) {
			const pos = -half + i * step;
			const is_center = Math.abs(pos) < step * 0.5;
			const color = is_center ? CENTER_COLOR : LINE_COLOR;

			// line along Z axis (at x = pos)
			vertices.push(pos, 0, -half, ...color);
			vertices.push(pos, 0, half, ...color);

			// line along X axis (at z = pos)
			vertices.push(-half, 0, pos, ...color);
			vertices.push(half, 0, pos, ...color);
		}

		this.vertex_count = vertices.length / 6;

		// create VAO
		this.vao = gl.createVertexArray();
		gl.bindVertexArray(this.vao);

		// create buffer
		this.vertex_buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

		// position attribute (location 0)
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

		// color attribute (location 1)
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

		gl.bindVertexArray(null);
	}

	/**
	 * @param {Float32Array} view_matrix
	 * @param {Float32Array} projection_matrix
	 */
	render(view_matrix, projection_matrix) {
		if (!this.shader || !this.shader.is_valid())
			return;

		const gl = this.gl;

		this.shader.use();
		this.shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		this.shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);

		// disable depth write but keep depth test for proper layering
		this.ctx.set_depth_write(false);

		this.ctx.bind_vao(this.vao);
		gl.drawArrays(gl.LINES, 0, this.vertex_count);

		// restore depth write
		this.ctx.set_depth_write(true);
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

		if (this.shader) {
			this.shader.dispose();
			this.shader = null;
		}
	}
}

module.exports = GridRenderer;
