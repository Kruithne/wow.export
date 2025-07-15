import { existsSync, mkdirSync } from 'fs';

export function get_platform() {
	switch (process.platform) {
		case 'win32': return 'windows';
		case 'darwin': return 'macos';
		case 'linux': return 'linux';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export function get_architecture() {
	switch (process.arch) {
		case 'x64': return 'x64';
		case 'arm64': return 'arm64';
		default: throw new Error(`Unsupported architecture: ${process.arch}`);
	}
}

export function get_runtime() {
	const arch = get_architecture();
	switch (process.platform) {
		case 'win32': return `win-${arch}`;
		case 'darwin': return `osx-${arch}`;
		case 'linux': return `linux-${arch}`;
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export async function ensure_directory(dir_path) {
	if (!existsSync(dir_path)) {
		mkdirSync(dir_path, { recursive: true });
		console.log(`Created directory: ${dir_path}`);
	}
}

export async function copy_file(source_path, dest_path) {
	const source_file = Bun.file(source_path);
	if (!(await source_file.exists())) {
		throw new Error(`Source file not found: ${source_path}`);
	}
	
	await Bun.write(dest_path, source_file);
	console.log(`Copied: ${source_path} → ${dest_path}`);
}