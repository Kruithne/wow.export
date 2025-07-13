#!/usr/bin/env bun

import { spawn } from 'bun';
import { join } from 'path';
import { get_platform, get_runtime, ensure_directory, copy_file } from './build/build_utils.js';

function get_library_filename() {
	switch (process.platform) {
		case 'win32': return 'wow_export.dll';
		case 'darwin': return 'wow_export.dylib';
		case 'linux': return 'wow_export.so';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

async function main() {
	const platform = get_platform();
	const runtime = get_runtime();
	
	console.log(`Building core library for ${platform} (${runtime})...`);
	
	const out_dir = join(process.cwd(), 'dist', 'out');
	await ensure_directory(out_dir);
	
	console.log('Running dotnet publish...');
	const build_result = spawn({
		cmd: ['dotnet', 'publish', 'core/core.csproj', '-c', 'Release', '-r', runtime],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await build_result.exited;
	if (exit_code !== 0) {
		console.error('Build failed with exit code:', exit_code);
		process.exit(exit_code);
	}
	
	const library_filename = get_library_filename();
	const source_path = join(process.cwd(), 'dist', 'native', 'net8.0', runtime, 'publish', library_filename);
	const dest_path = join(out_dir, library_filename);
	
	try {
		await copy_file(source_path, dest_path);
		console.log(`✓ Core library built successfully: ${library_filename}`);
	} catch (error) {
		console.error(`Failed to copy library file: ${error.message}`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Build failed:', error.message);
		process.exit(1);
	});
}