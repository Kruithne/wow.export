/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import log from '../../log.js';
import Shaders from '../Shaders.js';

class ShaderProgram {
	/**
	 * @param {GLContext} ctx
	 * @param {string} vert_source
	 * @param {string} frag_source
	 */
	constructor(ctx, vert_source, frag_source) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.program = null;
		this.uniform_locations = new Map();
		this.uniform_block_indices = new Map();

		this._compile(vert_source, frag_source);
	}

	/**
	 * @param {string} vert_source
	 * @param {string} frag_source
	 */
	_compile(vert_source, frag_source) {
		const gl = this.gl;

		const vert_shader = this._compile_shader(gl.VERTEX_SHADER, vert_source);
		const frag_shader = this._compile_shader(gl.FRAGMENT_SHADER, frag_source);

		if (!vert_shader || !frag_shader)
			return;

		const program = gl.createProgram();
		gl.attachShader(program, vert_shader);
		gl.attachShader(program, frag_shader);
		gl.linkProgram(program);

		// shaders can be deleted after linking
		gl.deleteShader(vert_shader);
		gl.deleteShader(frag_shader);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const info = gl.getProgramInfoLog(program);
			log.write('Shader program link error: %s', info);
			gl.deleteProgram(program);
			return;
		}

		this.program = program;
	}

	/**
	 * @param {number} type
	 * @param {string} source
	 * @returns {WebGLShader|null}
	 */
	_compile_shader(type, source) {
		const gl = this.gl;
		const shader = gl.createShader(type);

		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const info = gl.getShaderInfoLog(shader);
			const type_name = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
			log.write('Shader compile error (%s): %s', type_name, info);
			gl.deleteShader(shader);
			return null;
		}

		return shader;
	}

	/**
	 * @returns {boolean}
	 */
	is_valid() {
		return this.program !== null;
	}

	use() {
		this.ctx.use_program(this.program);
	}

	/**
	 * @param {string} name
	 * @returns {WebGLUniformLocation|null}
	 */
	get_uniform_location(name) {
		if (this.uniform_locations.has(name))
			return this.uniform_locations.get(name);

		const location = this.gl.getUniformLocation(this.program, name);
		this.uniform_locations.set(name, location);
		return location;
	}

	/**
	 * @param {string} name
	 * @returns {number}
	 */
	get_uniform_block_index(name) {
		if (this.uniform_block_indices.has(name))
			return this.uniform_block_indices.get(name);

		const index = this.gl.getUniformBlockIndex(this.program, name);
		this.uniform_block_indices.set(name, index);
		return index;
	}

	/**
	 * @param {string} name
	 * @param {number} binding_point
	 */
	bind_uniform_block(name, binding_point) {
		const index = this.get_uniform_block_index(name);
		if (index !== this.gl.INVALID_INDEX)
			this.gl.uniformBlockBinding(this.program, index, binding_point);
	}

	/**
	 * @param {string} name
	 * @param {number} value
	 */
	set_uniform_1i(name, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform1i(loc, value);
	}

	/**
	 * @param {string} name
	 * @param {number} value
	 */
	set_uniform_1f(name, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform1f(loc, value);
	}

	/**
	 * @param {string} name
	 * @param {number} x
	 * @param {number} y
	 */
	set_uniform_2f(name, x, y) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform2f(loc, x, y);
	}

	/**
	 * @param {string} name
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 */
	set_uniform_3f(name, x, y, z) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform3f(loc, x, y, z);
	}

	/**
	 * @param {string} name
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @param {number} w
	 */
	set_uniform_4f(name, x, y, z, w) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform4f(loc, x, y, z, w);
	}

	/**
	 * @param {string} name
	 * @param {Float32Array|number[]} value
	 */
	set_uniform_3fv(name, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform3fv(loc, value);
	}

	/**
	 * @param {string} name
	 * @param {Float32Array|number[]} value
	 */
	set_uniform_4fv(name, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniform4fv(loc, value);
	}

	/**
	 * @param {string} name
	 * @param {boolean} transpose
	 * @param {Float32Array|number[]} value
	 */
	set_uniform_mat3(name, transpose, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniformMatrix3fv(loc, transpose, value);
	}

	/**
	 * @param {string} name
	 * @param {boolean} transpose
	 * @param {Float32Array|number[]} value
	 */
	set_uniform_mat4(name, transpose, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniformMatrix4fv(loc, transpose, value);
	}

	/**
	 * @param {string} name
	 * @param {boolean} transpose
	 * @param {Float32Array|number[]} value
	 */
	set_uniform_mat4_array(name, transpose, value) {
		const loc = this.get_uniform_location(name);
		if (loc !== null)
			this.gl.uniformMatrix4fv(loc, transpose, value);
	}

	/**
	 * Recompile shader with new source (hot-reload)
	 * @param {string} vert_source
	 * @param {string} frag_source
	 * @returns {boolean}
	 */
	recompile(vert_source, frag_source) {
		const gl = this.gl;

		const vert_shader = this._compile_shader(gl.VERTEX_SHADER, vert_source);
		const frag_shader = this._compile_shader(gl.FRAGMENT_SHADER, frag_source);

		if (!vert_shader || !frag_shader) {
			if (vert_shader)
				gl.deleteShader(vert_shader);

			if (frag_shader)
				gl.deleteShader(frag_shader);

			return false;
		}

		const new_program = gl.createProgram();
		gl.attachShader(new_program, vert_shader);
		gl.attachShader(new_program, frag_shader);
		gl.linkProgram(new_program);

		gl.deleteShader(vert_shader);
		gl.deleteShader(frag_shader);

		if (!gl.getProgramParameter(new_program, gl.LINK_STATUS)) {
			const info = gl.getProgramInfoLog(new_program);
			log.write('Shader program link error on recompile: %s', info);
			gl.deleteProgram(new_program);
			return false;
		}

		// delete old program and swap in new one
		if (this.program)
			gl.deleteProgram(this.program);

		this.program = new_program;

		// clear uniform caches since locations change
		this.uniform_locations.clear();
		this.uniform_block_indices.clear();

		return true;
	}

	dispose() {
		// unregister from Shaders module if tracked
		if (this._shader_name) {
			Shaders.unregister(this);
		}

		if (this.program) {
			this.gl.deleteProgram(this.program);
			this.program = null;
		}

		this.uniform_locations.clear();
		this.uniform_block_indices.clear();
	}
}

export default ShaderProgram;