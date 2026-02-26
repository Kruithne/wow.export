/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

class GLTexture {
	/**
	 * @param {GLContext} ctx
	 */
	constructor(ctx) {
		this.ctx = ctx;
		this.gl = ctx.gl;
		this.texture = this.gl.createTexture();
		this.width = 0;
		this.height = 0;
		this.has_alpha = false;
	}

	/**
	 * @param {number} unit
	 */
	bind(unit) {
		this.ctx.bind_texture(unit, this.texture);
	}

	/**
	 * Set texture from RGBA pixel data
	 * @param {Uint8Array|Uint8ClampedArray} pixels
	 * @param {number} width
	 * @param {number} height
	 * @param {object} [options]
	 */
	set_rgba(pixels, width, height, options = {}) {
		const gl = this.gl;

		this.width = width;
		this.height = height;
		this.has_alpha = options.has_alpha ?? true;

		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		// flip Y to match Three.js texture loading behavior
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// reset flip state
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

		this._apply_wrap(options.wrap_s, options.wrap_t);
		this._apply_filter(options.min_filter, options.mag_filter);

		if (options.generate_mipmaps)
			gl.generateMipmap(gl.TEXTURE_2D);
	}

	/**
	 * Set texture from canvas
	 * @param {HTMLCanvasElement} canvas
	 * @param {object} [options]
	 */
	set_canvas(canvas, options = {}) {
		const gl = this.gl;

		this.width = canvas.width;
		this.height = canvas.height;
		this.has_alpha = true;

		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		// flip Y to match Three.js texture loading behavior
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

		// reset flip state
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

		this._apply_wrap(options.wrap_s, options.wrap_t);
		this._apply_filter(options.min_filter, options.mag_filter);

		if (options.generate_mipmaps)
			gl.generateMipmap(gl.TEXTURE_2D);
	}

	/**
	 * Set compressed texture (DXT)
	 * @param {object[]} mipmaps - array of {data, width, height}
	 * @param {number} format - compressed format
	 */
	set_compressed(mipmaps, format) {
		const gl = this.gl;

		if (!this.ctx.ext_s3tc)
			throw new Error('S3TC compression not supported');

		gl.bindTexture(gl.TEXTURE_2D, this.texture);

		for (let i = 0; i < mipmaps.length; i++) {
			const mip = mipmaps[i];
			gl.compressedTexImage2D(gl.TEXTURE_2D, i, format, mip.width, mip.height, 0, mip.data);
		}

		this.width = mipmaps[0].width;
		this.height = mipmaps[0].height;

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, mipmaps.length - 1);
		this._apply_wrap();
		this._apply_filter(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
	}

	/**
	 * @param {number} [wrap_s]
	 * @param {number} [wrap_t]
	 */
	_apply_wrap(wrap_s, wrap_t) {
		const gl = this.gl;

		wrap_s = wrap_s ?? gl.CLAMP_TO_EDGE;
		wrap_t = wrap_t ?? gl.CLAMP_TO_EDGE;

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap_s);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap_t);
	}

	/**
	 * @param {number} [min_filter]
	 * @param {number} [mag_filter]
	 */
	_apply_filter(min_filter, mag_filter) {
		const gl = this.gl;

		min_filter = min_filter ?? gl.LINEAR;
		mag_filter = mag_filter ?? gl.LINEAR;

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min_filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag_filter);

		// apply anisotropic filtering if available
		if (this.ctx.ext_aniso && min_filter !== gl.NEAREST)
			gl.texParameterf(gl.TEXTURE_2D, this.ctx.ext_aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, this.ctx.max_anisotropy));
	}

	/**
	 * Set wrap mode
	 * @param {number} wrap_s
	 * @param {number} wrap_t
	 */
	set_wrap(wrap_s, wrap_t) {
		const gl = this.gl;

		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap_s);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap_t);
	}

	/**
	 * Create texture from BLP file
	 * @param {BLPFile} blp
	 * @param {object} [flags] - texture flags from M2/WMO
	 */
	set_blp(blp, flags = {}) {
		const gl = this.gl;

		// determine wrap mode from flags
		const wrap_s = (flags.wrap_s ?? (flags.flags & 0x1)) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
		const wrap_t = (flags.wrap_t ?? (flags.flags & 0x2)) ? gl.REPEAT : gl.CLAMP_TO_EDGE;

		// for now, always decode to RGBA
		// todo: support compressed textures when format issues are resolved
		const pixels = blp.toUInt8Array(0, 0b1111);
		this.set_rgba(pixels, blp.width, blp.height, {
			wrap_s: wrap_s,
			wrap_t: wrap_t,
			has_alpha: blp.alphaDepth > 0,
			generate_mipmaps: true
		});
	}

	dispose() {
		if (this.texture) {
			this.gl.deleteTexture(this.texture);
			this.texture = null;
		}
	}
}

// DXT format constants (from S3TC extension)
GLTexture.DXT1_RGB = 0x83F0;
GLTexture.DXT1_RGBA = 0x83F1;
GLTexture.DXT3 = 0x83F2;
GLTexture.DXT5 = 0x83F3;

export default GLTexture;