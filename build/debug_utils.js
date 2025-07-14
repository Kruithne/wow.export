import { spawn } from 'bun';
import { join } from 'path';
import { get_platform, get_runtime, ensure_directory, copy_file } from './build_utils.js';
import { existsSync, readdirSync, lstatSync } from 'fs';

export function get_debug_executable_filename(project_name) {
	const base_name = project_name === 'core' ? 'wow_export_core' : 'wow_export_cli';
	return process.platform === 'win32' ? `${base_name}.exe` : base_name;
}

export async function build_debug_core() {
	const platform = get_platform();
	
	console.log(`Building core executable for ${platform} - Debug mode...`);
	
	console.log('Running dotnet build...');
	const build_result = spawn({
		cmd: [
			'dotnet', 'build', 'core/core.csproj',
			'-c', 'Debug',
			'-p:PublishAot=false',
			'-p:DebugType=portable',
			'-p:DebugSymbols=true'
		],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await build_result.exited;
	if (exit_code !== 0) {
		console.error('Core build failed with exit code:', exit_code);
		process.exit(exit_code);
	}
	
	const output_dir = join(process.cwd(), 'dist', 'native', 'net8.0');
	if (!existsSync(output_dir)) {
		console.error(`Core build output directory not found: ${output_dir}`);
		process.exit(1);
	}
	
	console.log(`✓ Core built successfully in: ${output_dir}`);
	return output_dir;
}

export async function build_debug_cli() {
	const platform = get_platform();
	
	console.log(`Building CLI executable for ${platform} - Debug mode...`);
	
	console.log('Running dotnet build...');
	const build_result = spawn({
		cmd: [
			'dotnet', 'build', 'cli/cli.csproj',
			'-c', 'Debug',
			'-p:PublishAot=false',
			'-p:DebugType=portable',
			'-p:DebugSymbols=true'
		],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const exit_code = await build_result.exited;
	if (exit_code !== 0) {
		console.error('CLI build failed with exit code:', exit_code);
		process.exit(exit_code);
	}
	
	const output_dir = join(process.cwd(), 'dist', 'native', 'net8.0');
	if (!existsSync(output_dir)) {
		console.error(`CLI build output directory not found: ${output_dir}`);
		process.exit(1);
	}
	
	console.log(`✓ CLI built successfully in: ${output_dir}`);
	return output_dir;
}

export async function copy_debug_executable(source_path, target_dir, executable_name) {
	await ensure_directory(target_dir);
	const dest_path = join(target_dir, executable_name);
	
	try {
		await copy_file(source_path, dest_path);
		console.log(`✓ Copied ${executable_name} to ${target_dir}`);
		return dest_path;
	} catch (error) {
		console.error(`Failed to copy executable to ${target_dir}: ${error.message}`);
		process.exit(1);
	}
}

export async function copy_debug_runtime_files(project_name, target_dir) {
	const base_name = project_name === 'core' ? 'wow_export_core' : 'wow_export_cli';
	const source_dir = join(process.cwd(), 'dist', 'native', 'net8.0');
	
	// Copy all the runtime files needed for the executable
	const files_to_copy = [
		`${base_name}.dll`,
		`${base_name}.deps.json`,
		`${base_name}.runtimeconfig.json`
	];
	
	for (const file of files_to_copy) {
		const source_path = join(source_dir, file);
		const dest_path = join(target_dir, file);
		
		try {
			await copy_file(source_path, dest_path);
			console.log(`✓ Copied ${file} to ${target_dir}`);
		} catch (error) {
			console.warn(`Warning: Could not copy ${file}: ${error.message}`);
		}
	}
}

export async function copy_debug_directory(source_dir, target_dir) {
	await ensure_directory(target_dir);
	
	if (!existsSync(source_dir)) {
		throw new Error(`Source directory not found: ${source_dir}`);
	}
	
	const entries = readdirSync(source_dir);
	
	for (const entry of entries) {
		const source_path = join(source_dir, entry);
		const dest_path = join(target_dir, entry);
		
		if (lstatSync(source_path).isDirectory()) {
			await copy_debug_directory(source_path, dest_path);
		} else {
			await copy_file(source_path, dest_path);
		}
	}
	
	console.log(`✓ Copied directory: ${source_dir} → ${target_dir}`);
}