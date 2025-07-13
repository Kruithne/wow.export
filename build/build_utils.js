import { existsSync, mkdirSync } from 'fs';

export function get_platform() {
	switch (process.platform) {
		case 'win32': return 'windows';
		case 'darwin': return 'macos';
		case 'linux': return 'linux';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export function get_runtime() {
	switch (process.platform) {
		case 'win32': return 'win-x64';
		case 'darwin': return 'osx-x64';
		case 'linux': return 'linux-x64';
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