/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const BlendMode = {
	OPAQUE: 0,
	ALPHA_KEY: 1,
	ALPHA: 2,
	ADD: 3,
	MOD: 4,
	MOD2X: 5,
	MOD_ADD: 6,
	INV_SRC_ALPHA_ADD: 7,
	INV_SRC_ALPHA_OPAQUE: 8,
	SRC_ALPHA_OPAQUE: 9,
	NO_ALPHA_ADD: 10,
	CONSTANT_ALPHA: 11,
	SCREEN: 12,
	BLEND_ADD: 13
};

class GLContext {
	/**
	 * @param {HTMLCanvasElement} canvas
	 * @param {object} [options]
	 */
	constructor(canvas, options = {}) {
		this.canvas = canvas;

		const gl_options = {
			antialias: options.antialias ?? true,
			alpha: options.alpha ?? true,
			preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
			powerPreference: 'high-performance'
		};

		this.gl = canvas.getContext('webgl2', gl_options);
		if (!this.gl)
			throw new Error('WebGL2 not supported');

		this._init_extensions();
		this._init_state();
	}

	_init_extensions() {
		const gl = this.gl;

		// compressed texture formats
		this.ext_s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
		this.ext_s3tc_srgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');

		// anisotropic filtering
		this.ext_aniso = gl.getExtension('EXT_texture_filter_anisotropic');
		if (this.ext_aniso)
			this.max_anisotropy = gl.getParameter(this.ext_aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
		else
			this.max_anisotropy = 1;

		// float textures
		this.ext_float_texture = gl.getExtension('EXT_color_buffer_float');
	}

	_init_state() {
		const gl = this.gl;

		// state cache
		this._depth_test = false;
		this._depth_write = true;
		this._depth_func = gl.LEQUAL;
		this._cull_face = false;
		this._cull_mode = gl.BACK;
		this._blend = false;
		this._blend_src = gl.ONE;
		this._blend_dst = gl.ZERO;
		this._current_program = null;
		this._current_vao = null;
		this._bound_textures = new Array(16).fill(null);
		this._active_texture_unit = 0;

		// default state
		gl.enable(gl.DEPTH_TEST);
		this._depth_test = true;
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.disable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.disable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ZERO);

		// clear color
		gl.clearColor(0, 0, 0, 0);
	}

	/**
	 * @param {number} width
	 * @param {number} height
	 */
	set_viewport(width, height) {
		this.gl.viewport(0, 0, width, height);
		this.viewport_width = width;
		this.viewport_height = height;
	}

	/**
	 * @param {boolean} color
	 * @param {boolean} depth
	 * @param {boolean} stencil
	 */
	clear(color = true, depth = true, stencil = false) {
		const gl = this.gl;
		let bits = 0;

		if (color)
			bits |= gl.COLOR_BUFFER_BIT;

		if (depth)
			bits |= gl.DEPTH_BUFFER_BIT;

		if (stencil)
			bits |= gl.STENCIL_BUFFER_BIT;

		if (bits)
			gl.clear(bits);
	}

	/**
	 * @param {number} r
	 * @param {number} g
	 * @param {number} b
	 * @param {number} a
	 */
	set_clear_color(r, g, b, a = 1) {
		this.gl.clearColor(r, g, b, a);
	}

	/**
	 * @param {boolean} enable
	 */
	set_depth_test(enable) {
		if (this._depth_test === enable)
			return;

		const gl = this.gl;
		if (enable)
			gl.enable(gl.DEPTH_TEST);
		else
			gl.disable(gl.DEPTH_TEST);

		this._depth_test = enable;
	}

	/**
	 * @param {boolean} enable
	 */
	set_depth_write(enable) {
		if (this._depth_write === enable)
			return;

		this.gl.depthMask(enable);
		this._depth_write = enable;
	}

	/**
	 * @param {number} func
	 */
	set_depth_func(func) {
		if (this._depth_func === func)
			return;

		this.gl.depthFunc(func);
		this._depth_func = func;
	}

	/**
	 * @param {boolean} enable
	 */
	set_cull_face(enable) {
		if (this._cull_face === enable)
			return;

		const gl = this.gl;
		if (enable)
			gl.enable(gl.CULL_FACE);
		else
			gl.disable(gl.CULL_FACE);

		this._cull_face = enable;
	}

	/**
	 * @param {number} mode - gl.FRONT, gl.BACK, or gl.FRONT_AND_BACK
	 */
	set_cull_mode(mode) {
		if (this._cull_mode === mode)
			return;

		this.gl.cullFace(mode);
		this._cull_mode = mode;
	}

	/**
	 * @param {boolean} enable
	 */
	set_blend(enable) {
		if (this._blend === enable)
			return;

		const gl = this.gl;
		if (enable)
			gl.enable(gl.BLEND);
		else
			gl.disable(gl.BLEND);

		this._blend = enable;
	}

	/**
	 * @param {number} src
	 * @param {number} dst
	 */
	set_blend_func(src, dst) {
		if (this._blend_src === src && this._blend_dst === dst)
			return;

		this.gl.blendFunc(src, dst);
		this._blend_src = src;
		this._blend_dst = dst;
	}

	/**
	 * @param {number} src_rgb
	 * @param {number} dst_rgb
	 * @param {number} src_alpha
	 * @param {number} dst_alpha
	 */
	set_blend_func_separate(src_rgb, dst_rgb, src_alpha, dst_alpha) {
		this.gl.blendFuncSeparate(src_rgb, dst_rgb, src_alpha, dst_alpha);
		this._blend_src = src_rgb;
		this._blend_dst = dst_rgb;
	}

	/**
	 * Apply WoW blend mode
	 * @param {number} blend_mode
	 */
	apply_blend_mode(blend_mode) {
		const gl = this.gl;

		switch (blend_mode) {
			case BlendMode.OPAQUE:
				this.set_blend(false);
				this.set_depth_write(true);
				break;

			case BlendMode.ALPHA_KEY:
				// alpha test handled in shader, depth write enabled since discarded pixels don't write depth
				this.set_blend(true);
				this.set_blend_func(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				this.set_depth_write(true);
				break;

			case BlendMode.ALPHA:
				this.set_blend(true);
				this.set_blend_func_separate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				this.set_depth_write(false);
				break;

			case BlendMode.ADD:
				this.set_blend(true);
				this.set_blend_func_separate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
				this.set_depth_write(false);
				break;

			case BlendMode.NO_ALPHA_ADD:
				this.set_blend(true);
				this.set_blend_func_separate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
				this.set_depth_write(false);
				break;

			case BlendMode.MOD:
				this.set_blend(true);
				this.set_blend_func(gl.DST_COLOR, gl.ZERO);
				this.set_depth_write(false);
				break;

			case BlendMode.MOD2X:
				this.set_blend(true);
				this.set_blend_func(gl.DST_COLOR, gl.SRC_COLOR);
				this.set_depth_write(false);
				break;

			case BlendMode.MOD_ADD:
				this.set_blend(true);
				this.set_blend_func_separate(gl.DST_COLOR, gl.ONE, gl.DST_ALPHA, gl.ONE);
				this.set_depth_write(false);
				break;

			case BlendMode.INV_SRC_ALPHA_ADD:
				this.set_blend(true);
				this.set_blend_func(gl.ONE_MINUS_SRC_ALPHA, gl.ONE);
				this.set_depth_write(false);
				break;

			case BlendMode.INV_SRC_ALPHA_OPAQUE:
				this.set_blend(true);
				this.set_blend_func(gl.ONE_MINUS_SRC_ALPHA, gl.ZERO);
				this.set_depth_write(true);
				break;

			case BlendMode.SRC_ALPHA_OPAQUE:
				this.set_blend(true);
				this.set_blend_func(gl.SRC_ALPHA, gl.ZERO);
				this.set_depth_write(true);
				break;

			case BlendMode.CONSTANT_ALPHA:
				this.set_blend(true);
				this.set_blend_func(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
				this.set_depth_write(false);
				break;

			case BlendMode.SCREEN:
				this.set_blend(true);
				this.set_blend_func(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
				this.set_depth_write(false);
				break;

			case BlendMode.BLEND_ADD:
				this.set_blend(true);
				this.set_blend_func_separate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				this.set_depth_write(false);
				break;

			default:
				this.set_blend(false);
				this.set_depth_write(true);
		}
	}

	/**
	 * @param {WebGLProgram} program
	 */
	use_program(program) {
		if (this._current_program === program)
			return;

		this.gl.useProgram(program);
		this._current_program = program;
	}

	/**
	 * @param {WebGLVertexArrayObject} vao
	 */
	bind_vao(vao) {
		if (this._current_vao === vao)
			return;

		this.gl.bindVertexArray(vao);
		this._current_vao = vao;
	}

	/**
	 * @param {number} unit
	 */
	active_texture(unit) {
		if (this._active_texture_unit === unit)
			return;

		this.gl.activeTexture(this.gl.TEXTURE0 + unit);
		this._active_texture_unit = unit;
	}

	/**
	 * @param {number} unit
	 * @param {WebGLTexture} texture
	 * @param {number} [target=gl.TEXTURE_2D]
	 */
	bind_texture(unit, texture, target = this.gl.TEXTURE_2D) {
		if (this._bound_textures[unit] === texture)
			return;

		this.active_texture(unit);
		this.gl.bindTexture(target, texture);
		this._bound_textures[unit] = texture;
	}

	/**
	 * @param {number} mode
	 * @param {number} count
	 * @param {number} type
	 * @param {number} offset
	 */
	draw_elements(mode, count, type, offset) {
		this.gl.drawElements(mode, count, type, offset);
	}

	/**
	 * @param {number} mode
	 * @param {number} first
	 * @param {number} count
	 */
	draw_arrays(mode, first, count) {
		this.gl.drawArrays(mode, first, count);
	}

	dispose() {
		// context is automatically cleaned up when canvas is removed
		this.gl = null;
		this.canvas = null;
	}
}

GLContext.BlendMode = BlendMode;

module.exports = GLContext;
