#!/usr/bin/env bun

import { createHash } from 'crypto';
import { readdirSync, statSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { spawn } from 'bun';

async function compute_sha256_hash(file_path) {
	const file = Bun.file(file_path);
	const hash = createHash('sha256');
	const buffer = await file.arrayBuffer();
	hash.update(new Uint8Array(buffer));
	return hash.digest('hex');
}

async function scan_directory_recursive(dir_path, base_path = '') {
	const entries = [];
	const items = readdirSync(dir_path);
	
	for (const item of items) {
		const item_path = join(dir_path, item);
		const relative_path = base_path ? join(base_path, item) : item;
		const stat = statSync(item_path);
		
		if (stat.isDirectory()) {
			const sub_entries = await scan_directory_recursive(item_path, relative_path);
			entries.push(...sub_entries);
		} else if (stat.isFile()) {
			const hash = await compute_sha256_hash(item_path);
			entries.push({
				path: relative_path.replace(/\\/g, '/'), // Normalize path separators
				size: stat.size,
				hash: hash
			});
		}
	}
	
	return entries;
}

async function download_and_extract_zip(zip_url, extract_path) {
	console.log(`Downloading ZIP from: ${zip_url}`);
	
	const response = await fetch(zip_url);
	if (!response.ok)
		throw new Error(`Failed to download ZIP: HTTP ${response.status}`);
	
	const zip_data = await response.arrayBuffer();
	const temp_zip_path = join(extract_path, 'temp_package.zip');
	
	mkdirSync(extract_path, { recursive: true });
	
	await Bun.write(temp_zip_path, zip_data);
	
	console.log(`Extracting ZIP to: ${extract_path}`);
	const extract_result = await spawn({
		cmd: process.platform === 'win32' 
			? ['powershell', '-Command', `Expand-Archive -Path "${temp_zip_path}" -DestinationPath "${extract_path}" -Force`]
			: ['unzip', '-o', temp_zip_path, '-d', extract_path],
		cwd: process.cwd(),
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	if (extract_result.exitCode !== 0)
		throw new Error(`Failed to extract ZIP file: exit code ${extract_result.exitCode}`);
	
	rmSync(temp_zip_path);
	
	console.log('ZIP extraction completed');
}

async function send_update_trigger(build_id, manifest, update_package_url, api_key) {
	const endpoint = `https://kruithne.net/wow.export/v2/trigger_update/${api_key}`;
	
	const payload = {
		build_id,
		manifest,
		update_package: update_package_url
	};
	
	console.log(`Build ID: ${build_id}`);
	console.log(`Manifest entries: ${manifest.length}`);
	console.log(`Update package URL: ${update_package_url}`);
	
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(payload)
		});
		
		if (!response.ok) {
			const error_text = await response.text();
			throw new Error(`HTTP ${response.status}: ${error_text}`);
		}
		
		const result = await response.json();
		console.log('Update trigger sent successfully:', result);
		return result;
	} catch (error) {
		console.error('Failed to send update trigger:', error.message);
		throw error;
	}
}

async function main() {
	const args = process.argv.slice(2);
	
	if (args.length !== 3) {
		console.error('Usage: bun deploy_build.js <build_id> <update_package_url> <api_key>');
		console.error('Example: bun deploy_build.js win32_x64 https://github.com/releases/package.zip api-key');
		process.exit(1);
	}
	
	const [build_id, update_package_url, api_key] = args;
	
	const temp_extract_path = join(process.cwd(), 'temp_extract');
	
	try {
		await download_and_extract_zip(update_package_url, temp_extract_path);
		
		console.log(`Scanning extracted directory: ${temp_extract_path}`);
		const manifest = await scan_directory_recursive(temp_extract_path);
		
		if (manifest.length === 0) {
			console.error('No files found in extracted ZIP package.');
			process.exit(1);
		}
		
		console.log(`Generated manifest with ${manifest.length} files:`);
		for (const entry of manifest)
			console.log(`  ${entry.path} (${entry.size} bytes, ${entry.hash})`);
		
		await send_update_trigger(build_id, manifest, update_package_url, api_key);
		
		console.log('✓ Deploy build completed successfully');
	} catch (error) {
		console.error('Deploy build failed:', error.message);
		process.exit(1);
	} finally {
		try {
			rmSync(temp_extract_path, { recursive: true, force: true });
			console.log('Cleaned up temporary files');
		} catch (cleanup_error) {
			console.warn('Failed to clean up temporary files:', cleanup_error.message);
		}
	}
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Deploy build failed:', error.message);
		process.exit(1);
	});
}