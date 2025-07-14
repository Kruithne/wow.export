#!/usr/bin/env bun

import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { get_platform, ensure_directory } from './build/build_utils.js';
import { compile_protobuf } from './compile_protobuf.js';

function get_electron_platform() {
	switch (process.platform) {
		case 'win32': return 'win32';
		case 'darwin': return 'darwin';
		case 'linux': return 'linux';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

function get_icon_path() {
	switch (process.platform) {
		case 'win32': return 'gui/assets/icon.ico';
		case 'darwin': return 'gui/assets/icon.icns';
		case 'linux': return 'gui/assets/icon.png';
		default: throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

function get_output_directory_name() {
	const electron_platform = get_electron_platform();
	return `wow_export-${electron_platform}-x64`;
}

async function copy_directory_contents(source_path, dest_path) {
	console.log(`Copying directory contents: ${source_path}/* → ${dest_path}`);
	
	const copy_result = spawn({
		cmd: process.platform === 'win32' 
			? ['xcopy', `${source_path}\\*`, dest_path, '/E', '/I', '/Y']
			: ['cp', '-r', `${source_path}/.`, dest_path],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await copy_result.exited;
	if (exit_code !== 0) {
		throw new Error(`Failed to copy directory contents: ${source_path}`);
	}
}

async function main() {
	const platform = get_platform();
	const electron_platform = get_electron_platform();
	const icon_path = get_icon_path();
	
	console.log(`Building GUI application for ${platform}...`);
	
	await compile_protobuf();
	
	const out_dir = join(process.cwd(), 'dist', 'out');
	await ensure_directory(out_dir);
	
	const current_year = new Date().getFullYear();
	
	console.log('Running electron-packager...');
	const packager_args = [
		'electron-packager',
		'./gui',
		'wow_export',
		`--platform=${electron_platform}`,
		'--arch=x64',
		'--out=dist/',
		'--overwrite',
		'--asar',
		'--prune=true',
		'--ignore="(\\.md$|\\.txt$|\\.map$|test|spec|__tests__|\\.git)"',
		`--icon=${icon_path}`,
		`--app-copyright=Copyright © ${current_year} Kruithne, Marlamin`
	];
	
	if (process.platform === 'win32') {
		packager_args.push('--win32metadata.CompanyName=Kruithne, Marlamin');
		packager_args.push('--win32metadata.ProductName=wow.export');
	}
	
	const build_result = spawn({
		cmd: ['bunx', ...packager_args],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await build_result.exited;
	if (exit_code !== 0) {
		console.error('Build failed with exit code:', exit_code);
		process.exit(exit_code);
	}
	
	const output_dir_name = get_output_directory_name();
	const source_path = join(process.cwd(), 'dist', output_dir_name);
	const old_subdirectory = join(out_dir, output_dir_name);
	
	try {
		await copy_directory_contents(source_path, out_dir);
		
		if (existsSync(old_subdirectory)) {
			const remove_result = spawn({
				cmd: process.platform === 'win32'
					? ['rmdir', '/S', '/Q', old_subdirectory]
					: ['rm', '-rf', old_subdirectory],
				cwd: process.cwd(),
				stdio: ['inherit', 'inherit', 'inherit']
			});
			await remove_result.exited;
		}
		
		console.log(`✓ GUI application built successfully - files copied to /dist/out`);
	} catch (error) {
		console.error(`Failed to copy GUI directory contents: ${error.message}`);
		process.exit(1);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Build failed:', error.message);
		process.exit(1);
	});
}