#!/usr/bin/env bun

import { spawn } from 'bun';
import { join } from 'path';
import { build_debug_core, copy_debug_directory } from './build/debug_utils.js';

async function main() {
	console.log('Building Core for GUI debugging...');
	
	const gui_debug_dir = join(process.cwd(), 'dist', 'debug_gui');
	
	const build_output_dir = await build_debug_core();
	await copy_debug_directory(build_output_dir, gui_debug_dir);
	
	console.log('✓ Debug build complete!');
	console.log(`Launching GUI from ${gui_debug_dir}...`);
	
	const electron_process = spawn({
		cmd: ['bunx', 'electron', '../../gui', '--dev'],
		cwd: gui_debug_dir,
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await electron_process.exited;
	process.exit(exit_code);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Debug GUI failed:', error.message);
		process.exit(1);
	});
}