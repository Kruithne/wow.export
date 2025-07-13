#!/usr/bin/env bun

import { spawn } from 'bun';
import { join } from 'path';
import { get_platform, get_runtime, ensure_directory, copy_file } from './build/build_utils.js';

function get_executable_filename() {
	switch (process.platform) {
		case 'win32': return 'wow_export_core.exe';
		case 'darwin':
		case 'linux': return 'wow_export_core';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

async function main() {
	const platform = get_platform();
	const runtime = get_runtime();
	
	console.log(`Building core executable for ${platform} (${runtime})...`);
	
	const out_dir = join(process.cwd(), 'dist', 'out');
	await ensure_directory(out_dir);
	
	console.log('Running dotnet publish...');
	const build_result = spawn({
		cmd: [
			'dotnet', 'publish', 'core/core.csproj',
			'-c', 'Release',
			'-r', runtime,
			'--self-contained', 'true'
		],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await build_result.exited;
	if (exit_code !== 0) {
		console.error('Build failed with exit code:', exit_code);
		process.exit(exit_code);
	}
	
	const executable_filename = get_executable_filename();
	const source_path = join(process.cwd(), 'dist', 'native', 'net8.0', runtime, 'publish', executable_filename);
	const dest_path = join(out_dir, executable_filename);
	
	try {
		await copy_file(source_path, dest_path);
		console.log(`✓ Core executable built successfully: ${executable_filename}`);
	} catch (error) {
		console.error(`Failed to copy executable file: ${error.message}`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Build failed:', error.message);
		process.exit(1);
	});
}