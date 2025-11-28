/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

class UniformBuffer {
	/**
	 * @param {GLContext} ctx
	 * @param {number} size - buffer size in bytes
	 * @param {number} [usage=gl.DYNAMIC_DRAW]
	 */
	constructor(ctx, size, usage) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.size = size;
		this.usage = usage ?? this.gl.DYNAMIC_DRAW;
		this.buffer = this.gl.createBuffer();
		this.data = new ArrayBuffer(size);
		this.view = new DataView(this.data);
		this.float_view = new Float32Array(this.data);
		this.int_view = new Int32Array(this.data);
		this.dirty = false;

		// allocate gpu buffer
		this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.buffer);
		this.gl.bufferData(this.gl.UNIFORM_BUFFER, size, this.usage);
	}

	/**
	 * @param {number} binding_point
	 */
	bind(binding_point) {
		this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, binding_point, this.buffer);
	}

	/**
	 * @param {number} binding_point
	 * @param {number} offset
	 * @param {number} size
	 */
	bind_range(binding_point, offset, size) {
		this.gl.bindBufferRange(this.gl.UNIFORM_BUFFER, binding_point, this.buffer, offset, size);
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} value
	 */
	set_float(offset, value) {
		this.view.setFloat32(offset, value, true);
		this.dirty = true;
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} value
	 */
	set_int(offset, value) {
		this.view.setInt32(offset, value, true);
		this.dirty = true;
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} x
	 * @param {number} y
	 */
	set_vec2(offset, x, y) {
		this.view.setFloat32(offset, x, true);
		this.view.setFloat32(offset + 4, y, true);
		this.dirty = true;
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 */
	set_vec3(offset, x, y, z) {
		this.view.setFloat32(offset, x, true);
		this.view.setFloat32(offset + 4, y, true);
		this.view.setFloat32(offset + 8, z, true);
		this.dirty = true;
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @param {number} w
	 */
	set_vec4(offset, x, y, z, w) {
		this.view.setFloat32(offset, x, true);
		this.view.setFloat32(offset + 4, y, true);
		this.view.setFloat32(offset + 8, z, true);
		this.view.setFloat32(offset + 12, w, true);
		this.dirty = true;
	}

	/**
	 * @param {number} offset - byte offset
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @param {number} w
	 */
	set_ivec4(offset, x, y, z, w) {
		this.view.setInt32(offset, x, true);
		this.view.setInt32(offset + 4, y, true);
		this.view.setInt32(offset + 8, z, true);
		this.view.setInt32(offset + 12, w, true);
		this.dirty = true;
	}

	/**
	 * set mat4 (16 floats = 64 bytes)
	 * @param {number} offset - byte offset
	 * @param {Float32Array|number[]} matrix - column-major 4x4 matrix
	 */
	set_mat4(offset, matrix) {
		const float_offset = offset / 4;
		for (let i = 0; i < 16; i++)
			this.float_view[float_offset + i] = matrix[i];

		this.dirty = true;
	}

	/**
	 * set mat4 array
	 * @param {number} offset - byte offset
	 * @param {Float32Array|number[]} matrices - array of matrices
	 * @param {number} count - number of matrices
	 */
	set_mat4_array(offset, matrices, count) {
		const float_offset = offset / 4;
		const float_count = count * 16;

		for (let i = 0; i < float_count; i++)
			this.float_view[float_offset + i] = matrices[i];

		this.dirty = true;
	}

	/**
	 * set float array
	 * @param {number} offset - byte offset
	 * @param {Float32Array|number[]} values
	 */
	set_float_array(offset, values) {
		const float_offset = offset / 4;
		for (let i = 0; i < values.length; i++)
			this.float_view[float_offset + i] = values[i];

		this.dirty = true;
	}

	/**
	 * set vec4 array
	 * @param {number} offset - byte offset
	 * @param {Float32Array|number[]} values - flat array of vec4 components
	 * @param {number} count - number of vec4s
	 */
	set_vec4_array(offset, values, count) {
		const float_offset = offset / 4;
		const float_count = count * 4;

		for (let i = 0; i < float_count; i++)
			this.float_view[float_offset + i] = values[i];

		this.dirty = true;
	}

	/**
	 * Upload data to GPU if dirty
	 */
	upload() {
		if (!this.dirty)
			return;

		this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.buffer);
		this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, this.data);
		this.dirty = false;
	}

	/**
	 * Upload partial data to GPU
	 * @param {number} offset
	 * @param {number} size
	 */
	upload_range(offset, size) {
		this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, this.buffer);
		this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, offset, new Uint8Array(this.data, offset, size));
	}

	dispose() {
		if (this.buffer) {
			this.gl.deleteBuffer(this.buffer);
			this.buffer = null;
		}

		this.data = null;
		this.view = null;
		this.float_view = null;
		this.int_view = null;
	}
}

// std140 alignment helpers
UniformBuffer.ALIGN_VEC4 = 16;
UniformBuffer.ALIGN_MAT4 = 64;
UniformBuffer.SIZE_FLOAT = 4;
UniformBuffer.SIZE_VEC2 = 8;
UniformBuffer.SIZE_VEC3 = 12;
UniformBuffer.SIZE_VEC4 = 16;
UniformBuffer.SIZE_MAT4 = 64;

/**
 * Calculate std140 aligned offset for next element
 * @param {number} current_offset
 * @param {number} alignment
 * @returns {number}
 */
UniformBuffer.align = function(current_offset, alignment) {
	return Math.ceil(current_offset / alignment) * alignment;
};

module.exports = UniformBuffer;
