#!/usr/bin/env bun

import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { log, log_color } from './log.js';

const build_config = await Bun.file('./build.json').json();
const nw_version = build_config.webkitVersion;
const addons_dir = resolve(process.cwd(), 'node_addons');

const versions_response = await fetch('https://nwjs.io/versions.json');
const versions_data = await versions_response.json();
const version_entry = versions_data.versions.find(v => v.version === `v${nw_version}`);

if (!version_entry)
	throw new Error(`nw.js version ${nw_version} not found in versions.json`);

const node_version = version_entry.components.node;
const gyp_dir = resolve(process.cwd(), 'bin/gyp');
const headers_url = `https://dl.nwjs.io/v${nw_version}/nw-headers-v${nw_version}.tar.gz`;
const headers_path = resolve(gyp_dir, `nw-headers-v${nw_version}.tar.gz`);
const node_dir = resolve(gyp_dir, 'node');
const node_lib_url = `https://nodejs.org/dist/v${node_version}/win-x64/node.lib`;
const node_lib_path = resolve(gyp_dir, 'node.lib');
const delay_hook_url = 'https://raw.githubusercontent.com/nwjs/nw.js/nw18/tools/win_delay_load_hook.cc';

async function download_headers() {
	if (!existsSync(gyp_dir))
		mkdirSync(gyp_dir, { recursive: true });

	if (!existsSync(headers_path)) {
		log.info('Downloading headers from *%s*...', headers_url);
		const response = await fetch(headers_url);

		if (!response.ok)
			throw new Error(`failed to download headers: ${response.statusText}`);

		const data = await response.arrayBuffer();
		await Bun.write(headers_path, data);
		log.success('Headers downloaded');
	} else {
		log.info('Headers already cached');
	}
}

async function patch_delay_load_hook() {
	const node_gyp_path = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
	const hook_path = resolve(node_gyp_path, 'node-gyp/src/win_delay_load_hook.cc');

	if (!existsSync(hook_path)) {
		log.warn('node-gyp delay hook not found at *%s*', hook_path);
		return;
	}

	log.info('Patching delay load hook at *%s*...', hook_path);
	const response = await fetch(delay_hook_url);

	if (!response.ok)
		throw new Error(`failed to download delay hook: ${response.statusText}`);

	const data = await response.arrayBuffer();
	await Bun.write(hook_path, data);
	log.success('Delay load hook patched');
}

async function download_node_lib() {
	if (!existsSync(node_lib_path)) {
		log.info('Downloading node.lib from *%s*...', node_lib_url);
		const response = await fetch(node_lib_url);

		if (!response.ok)
			throw new Error(`failed to download node.lib: ${response.statusText}`);

		await Bun.write(node_lib_path, response);
		log.success('node.lib downloaded');
	} else {
		log.info('node.lib already cached');
	}
}

function copy_libs() {
	const release_dir = resolve(node_dir, 'Release');
	if (!existsSync(release_dir))
		mkdirSync(release_dir, { recursive: true });

	const node_lib_dest = resolve(release_dir, 'node.lib');
	copyFileSync(node_lib_path, node_lib_dest);
	log.success('Copied node.lib to *%s*', node_lib_dest);
}

async function extract_headers() {
	if (existsSync(node_dir))
		rmSync(node_dir, { recursive: true });

	log.info('Extracting headers...');

	const proc = Bun.spawn(['tar', '-xzf', headers_path, '-C', gyp_dir], {
		stdout: 'inherit',
		stderr: 'inherit'
	});

	await proc.exited;

	if (proc.exitCode !== 0)
		throw new Error(`tar extraction failed with code ${proc.exitCode}`);

	log.success('Headers extracted');
}

async function patch_common_gypi() {
	const common_gypi_path = resolve(node_dir, 'common.gypi');

	if (!existsSync(common_gypi_path)) {
		log.warn('common.gypi not found, skipping patch');
		return;
	}

	log.info('Patching common.gypi for macOS compatibility...');

	let content = await Bun.file(common_gypi_path).text();

	// remove -fuse-ld=lld from macOS xcode_settings
	content = content.replace(
		"'-fuse-ld=lld -Wl,-search_paths_first'",
		"'-Wl,-search_paths_first'"
	);

	await Bun.write(common_gypi_path, content);
	log.success('common.gypi patched');
}

function install_deps(addon_dir) {
	const addon_name = join(addon_dir).split(/[/\\]/).pop();
	log.info('Installing dependencies for *%s*...', addon_name);
	execFileSync('bun', ['install'], {
		cwd: addon_dir,
		stdio: 'inherit'
	});
}

function rebuild_addon(addon_dir) {
	const addon_name = join(addon_dir).split(/[/\\]/).pop();
	log.info('Building addon *%s*...', addon_name);

	const gyp_cmd = process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp';
	const args = [
		'rebuild',
		`--target=${node_version}`,
		`--nodedir=${node_dir}`
	];

	if (process.platform === 'win32') {
		const node_lib_for_gyp = resolve(node_dir, 'Release/node.lib');
		args.push('--', `-Dnw_lib_file=${node_lib_for_gyp}`);
	}

	execFileSync(gyp_cmd, args, {
		cwd: addon_dir,
		stdio: 'inherit'
	});
}

function get_addon_dirs() {
	if (!existsSync(addons_dir))
		return [];

	return readdirSync(addons_dir)
		.map(name => join(addons_dir, name))
		.filter(path => statSync(path).isDirectory());
}

async function main() {
	const addon_dirs = get_addon_dirs();

	if (addon_dirs.length === 0) {
		log.warn('No addons found in *node_addons/*');
		return;
	}

	const addon_names = addon_dirs.map(d => join(d).split(/[/\\]/).pop()).map(n => log_color('cyan', n)).join(', ');
	log.info('nw.js version: *%s*', nw_version);
	log.info('node version: *%s*', node_version);
	log.info('Found *%d* addon(s): %s', addon_dirs.length, addon_names);

	try {
		// see https://github.com/nwjs/nw.js/issues/7978
		if (process.platform === 'win32')
			await patch_delay_load_hook();

		await download_headers();

		if (process.platform === 'win32')
			await download_node_lib();

		await extract_headers();

		if (process.platform === 'darwin')
			await patch_common_gypi();

		if (process.platform === 'win32')
			copy_libs();

		for (const addon_dir of addon_dirs) {
			install_deps(addon_dir);
			rebuild_addon(addon_dir);
			const addon_name = join(addon_dir).split(/[/\\]/).pop();
			log.success('Built *%s* -> *%s*', addon_name, join(addon_dir, 'build/Release'));
		}

		log.success('All addons built successfully');
	} catch (error) {
		log.error('Build failed: %s', error.message);
		process.exit(1);
	}
}

main();
