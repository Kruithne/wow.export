/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const { exec } = require('child_process');
const log = require('./log');
const generics = require('./generics');

/**
 * Get GPU renderer/vendor info and capabilities via WebGL.
 * @returns {object | null}
 */
const get_webgl_info = () => {
	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

		if (!gl)
			return null;

		const result = {
			vendor: null,
			renderer: null,
			caps: {},
			extensions: []
		};

		// vendor/renderer
		const debug_info = gl.getExtension('WEBGL_debug_renderer_info');
		if (debug_info) {
			result.vendor = gl.getParameter(debug_info.UNMASKED_VENDOR_WEBGL);
			result.renderer = gl.getParameter(debug_info.UNMASKED_RENDERER_WEBGL);
		}

		// capability limits
		result.caps = {
			max_tex_size: gl.getParameter(gl.MAX_TEXTURE_SIZE),
			max_cube_size: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
			max_varyings: gl.getParameter(gl.MAX_VARYING_VECTORS),
			max_vert_uniforms: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
			max_frag_uniforms: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
			max_vert_attribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
			max_tex_units: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
			max_vert_tex_units: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
			max_combined_tex_units: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
			max_renderbuffer: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
			max_viewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
		};

		// extensions
		result.extensions = gl.getSupportedExtensions() || [];

		return result;
	} catch (e) {
		return { error: e.message };
	}
};

/**
 * Execute a shell command and return stdout.
 * @param {string} cmd
 * @returns {Promise<string>}
 */
const exec_cmd = (cmd) => {
	return new Promise((resolve, reject) => {
		exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
			if (error)
				reject(error);
			else
				resolve(stdout.trim());
		});
	});
};

/**
 * Parse VRAM bytes to human-readable format.
 * @param {number} bytes
 * @returns {string}
 */
const format_vram = (bytes) => {
	if (!bytes || bytes <= 0)
		return 'Unknown';

	return generics.filesize(bytes);
};

/**
 * Get accurate VRAM from Windows registry.
 * @returns {Promise<number | null>} VRAM in bytes or null
 */
const get_windows_registry_vram = async () => {
	try {
		// query registry for qwMemorySize (64-bit accurate VRAM value)
		const ps_cmd = 'powershell -Command "Get-ItemProperty -Path \'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*\' -Name \'HardwareInformation.qwMemorySize\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty \'HardwareInformation.qwMemorySize\' | Select-Object -First 1"';
		const output = await exec_cmd(ps_cmd);
		const vram = parseInt(output.trim(), 10);

		if (vram > 0)
			return vram;
	} catch {
		// registry query failed, fall back to WMI
	}

	return null;
};

/**
 * Get GPU info on Windows via WMIC/PowerShell.
 * @returns {Promise<{ name: string, vram: string, driver: string } | null>}
 */
const get_windows_gpu_info = async () => {
	try {
		const output = await exec_cmd('wmic path win32_VideoController get Name,AdapterRAM,DriverVersion /format:csv');

		// split by both \r\n and \n, filter empty lines
		const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0);

		if (lines.length < 2) {
			log.write('GPU: WMIC returned insufficient data (%d lines)', lines.length);
			return null;
		}

		// csv format: Node,AdapterRAM,DriverVersion,Name
		const data_line = lines[1].trim();
		const parts = data_line.split(',');

		if (parts.length < 4) {
			log.write('GPU: WMIC CSV parse failed, expected 4 fields, got %d', parts.length);
			return null;
		}

		let adapter_ram = parseInt(parts[1], 10);
		const driver_version = parts[2];
		const name = parts[3];

		// wmi AdapterRAM is 32-bit, try registry for accurate value on >4GB GPUs
		const registry_vram = await get_windows_registry_vram();
		if (registry_vram !== null)
			adapter_ram = registry_vram;

		return {
			name: name || 'Unknown',
			vram: format_vram(adapter_ram),
			driver: driver_version || 'Unknown'
		};
	} catch (e) {
		log.write('GPU: Windows WMIC query failed: %s', e.message);
		return null;
	}
};

/**
 * Get GPU info on Linux.
 * @returns {Promise<{ name: string, vram: string, driver: string } | null>}
 */
const get_linux_gpu_info = async () => {
	const result = { name: 'Unknown', vram: 'Unknown', driver: 'Unknown' };

	// gpu name via lspci
	try {
		const lspci_output = await exec_cmd('lspci | grep -i vga');
		const match = lspci_output.match(/: (.+)$/m);
		if (match)
			result.name = match[1].trim();
	} catch (e) {
		log.write('GPU: Linux lspci query failed: %s', e.message);
	}

	// nvidia vram + driver
	try {
		const nvidia_mem = await exec_cmd('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits');
		const mem_mb = parseInt(nvidia_mem, 10);
		if (mem_mb > 0)
			result.vram = format_vram(mem_mb * 1024 * 1024);

		const nvidia_driver = await exec_cmd('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
		if (nvidia_driver)
			result.driver = nvidia_driver.trim();
	} catch {
		// nvidia-smi not available, try glxinfo
		try {
			const glx_output = await exec_cmd('glxinfo 2>/dev/null | grep -E "(OpenGL version|Video memory)"');
			const version_match = glx_output.match(/OpenGL version string: (.+)/);
			if (version_match)
				result.driver = version_match[1].trim();

			const mem_match = glx_output.match(/Video memory: (\d+)/);
			if (mem_match)
				result.vram = format_vram(parseInt(mem_match[1], 10) * 1024 * 1024);
		} catch {
			// glxinfo not available
		}
	}

	return result;
};

/**
 * Get GPU info on macOS via system_profiler.
 * @returns {Promise<{ name: string, vram: string, driver: string } | null>}
 */
const get_macos_gpu_info = async () => {
	try {
		const output = await exec_cmd('system_profiler SPDisplaysDataType');
		const result = { name: 'Unknown', vram: 'Unknown', driver: 'Unknown' };

		const chipset_match = output.match(/Chipset Model: (.+)/);
		if (chipset_match)
			result.name = chipset_match[1].trim();

		// vram can be "VRAM (Total):" or "VRAM (Dynamic, Max):"
		const vram_match = output.match(/VRAM \([^)]+\): (.+)/);
		if (vram_match)
			result.vram = vram_match[1].trim();

		const metal_match = output.match(/Metal.*: (.+)/);
		if (metal_match)
			result.driver = 'Metal ' + metal_match[1].trim();

		return result;
	} catch (e) {
		log.write('GPU: macOS system_profiler query failed: %s', e.message);
		return null;
	}
};

/**
 * Get platform-specific GPU info (VRAM, driver version).
 * @returns {Promise<{ name: string, vram: string, driver: string } | null>}
 */
const get_platform_gpu_info = async () => {
	const platform = process.platform;

	if (platform === 'win32')
		return get_windows_gpu_info();
	else if (platform === 'linux')
		return get_linux_gpu_info();
	else if (platform === 'darwin')
		return get_macos_gpu_info();

	return null;
};

/**
 * Format extension list into compact categories.
 * @param {string[]} extensions
 * @returns {string}
 */
const format_extensions = (extensions) => {
	const categories = {
		compressed: [],
		float: [],
		depth: [],
		instanced: false,
		vao: false,
		anisotropic: false,
		draw_buffers: false
	};

	for (const ext of extensions) {
		if (ext.includes('compressed_texture'))
			categories.compressed.push(ext.replace('WEBGL_compressed_texture_', '').replace('EXT_texture_compression_', ''));
		else if (ext.includes('float') || ext.includes('half_float'))
			categories.float.push(ext.replace('OES_texture_', '').replace('WEBGL_color_buffer_', 'cb_').replace('EXT_color_buffer_', 'cb_'));
		else if (ext.includes('depth'))
			categories.depth.push(ext.replace('WEBGL_', '').replace('EXT_', ''));
		else if (ext.includes('instanced'))
			categories.instanced = true;
		else if (ext.includes('vertex_array_object'))
			categories.vao = true;
		else if (ext.includes('anisotropic'))
			categories.anisotropic = true;
		else if (ext.includes('draw_buffers'))
			categories.draw_buffers = true;
	}

	const parts = [];

	if (categories.compressed.length > 0)
		parts.push('tex:' + categories.compressed.join('/'));

	if (categories.float.length > 0)
		parts.push('float:' + categories.float.join('/'));

	if (categories.depth.length > 0)
		parts.push('depth:' + categories.depth.join('/'));

	const flags = [];
	if (categories.instanced)
		flags.push('instanced');
	if (categories.vao)
		flags.push('vao');
	if (categories.anisotropic)
		flags.push('aniso');
	if (categories.draw_buffers)
		flags.push('mrt');

	if (flags.length > 0)
		parts.push(flags.join(','));

	return parts.join(' | ');
};

/**
 * Format capabilities into compact string.
 * @param {object} caps
 * @returns {string}
 */
const format_caps = (caps) => {
	const viewport = Array.isArray(caps.max_viewport) ? caps.max_viewport.join('x') : caps.max_viewport;

	return [
		'tex:' + caps.max_tex_size,
		'cube:' + caps.max_cube_size,
		'varyings:' + caps.max_varyings,
		'uniforms:' + caps.max_vert_uniforms + 'v/' + caps.max_frag_uniforms + 'f',
		'attribs:' + caps.max_vert_attribs,
		'texunits:' + caps.max_tex_units + '/' + caps.max_combined_tex_units,
		'rb:' + caps.max_renderbuffer,
		'vp:' + viewport
	].join(' ');
};

/**
 * Log GPU diagnostic information asynchronously.
 * Errors are logged rather than thrown.
 */
const log_gpu_info = async () => {
	const webgl = get_webgl_info();
	let platform_info = null;

	try {
		platform_info = await get_platform_gpu_info();
	} catch (e) {
		log.write('GPU: Platform query failed: %s', e.message);
	}

	// log everything together
	if (webgl?.error) {
		log.write('GPU: WebGL query failed: %s', webgl.error);
	} else if (webgl) {
		if (webgl.renderer)
			log.write('GPU: %s (%s)', webgl.renderer, webgl.vendor);
		else
			log.write('GPU: WebGL debug info unavailable');

		if (webgl.caps)
			log.write('GPU caps: %s', format_caps(webgl.caps));

		if (webgl.extensions?.length > 0)
			log.write('GPU ext (%d): %s', webgl.extensions.length, format_extensions(webgl.extensions));
	} else {
		log.write('GPU: WebGL unavailable');
	}

	if (platform_info)
		log.write('GPU: VRAM %s, Driver %s', platform_info.vram, platform_info.driver);
	else
		log.write('GPU: Platform-specific info unavailable');
};

module.exports = { log_gpu_info };
