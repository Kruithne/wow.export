import { exec } from 'node:child_process';
import * as log from './log.js';
import { filesize } from './generics.js';

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

const format_vram = (bytes) => {
	if (!bytes || bytes <= 0)
		return 'Unknown';

	return filesize(bytes);
};

const get_windows_registry_vram = async () => {
	try {
		const ps_cmd = 'powershell -Command "Get-ItemProperty -Path \'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*\' -Name \'HardwareInformation.qwMemorySize\' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty \'HardwareInformation.qwMemorySize\' | Select-Object -First 1"';
		const output = await exec_cmd(ps_cmd);
		const vram = parseInt(output.trim(), 10);

		if (vram > 0)
			return vram;
	} catch {
		// registry query failed
	}

	return null;
};

const get_windows_gpu_info = async () => {
	try {
		const output = await exec_cmd('wmic path win32_VideoController get Name,AdapterRAM,DriverVersion /format:csv');

		const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0);

		if (lines.length < 2) {
			log.write('GPU: WMIC returned insufficient data (%d lines)', lines.length);
			return null;
		}

		const data_line = lines[1].trim();
		const parts = data_line.split(',');

		if (parts.length < 4) {
			log.write('GPU: WMIC CSV parse failed, expected 4 fields, got %d', parts.length);
			return null;
		}

		let adapter_ram = parseInt(parts[1], 10);
		const driver_version = parts[2];
		const name = parts[3];

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

const get_linux_gpu_info = async () => {
	const result = { name: 'Unknown', vram: 'Unknown', driver: 'Unknown' };

	try {
		const lspci_output = await exec_cmd('lspci | grep -i vga');
		const match = lspci_output.match(/: (.+)$/m);
		if (match)
			result.name = match[1].trim();
	} catch (e) {
		log.write('GPU: Linux lspci query failed: %s', e.message);
	}

	try {
		const nvidia_mem = await exec_cmd('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits');
		const mem_mb = parseInt(nvidia_mem, 10);
		if (mem_mb > 0)
			result.vram = format_vram(mem_mb * 1024 * 1024);

		const nvidia_driver = await exec_cmd('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
		if (nvidia_driver)
			result.driver = nvidia_driver.trim();
	} catch {
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

const get_macos_gpu_info = async () => {
	try {
		const output = await exec_cmd('system_profiler SPDisplaysDataType');
		const result = { name: 'Unknown', vram: 'Unknown', driver: 'Unknown' };

		const chipset_match = output.match(/Chipset Model: (.+)/);
		if (chipset_match)
			result.name = chipset_match[1].trim();

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

export const get_platform_gpu_info = async () => {
	const platform = process.platform;

	if (platform === 'win32')
		return get_windows_gpu_info();
	else if (platform === 'linux')
		return get_linux_gpu_info();
	else if (platform === 'darwin')
		return get_macos_gpu_info();

	return null;
};
