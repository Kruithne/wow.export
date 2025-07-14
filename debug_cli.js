#!/usr/bin/env bun

import { spawn } from 'bun';
import { join } from 'path';
import { build_debug_core, build_debug_cli, copy_debug_directory } from './build/debug_utils.js';
import { compile_protobuf } from './compile_protobuf.js';

async function main() {
	console.log('Building CLI and Core for debugging...');
	
	await compile_protobuf();
	
	const cli_debug_dir = join(process.cwd(), 'dist', 'debug_cli');
	
	await build_debug_core();
	const build_output_dir = await build_debug_cli();
	
	await copy_debug_directory(build_output_dir, cli_debug_dir);
	
	console.log('✓ Debug builds complete!');
	console.log(`Launching CLI from ${cli_debug_dir}...`);
	
	const cli_filename = process.platform === 'win32' ? 'wow_export_cli.exe' : 'wow_export_cli';
	const cli_process = spawn({
		cmd: [`./${cli_filename}`],
		cwd: cli_debug_dir,
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await cli_process.exited;
	process.exit(exit_code);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Debug CLI failed:', error.message);
		process.exit(1);
	});
}