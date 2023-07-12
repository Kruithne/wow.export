import meta from './package.json';
import log from '@kogs/logger';
import { execSync } from 'child_process';
import JSZip from 'jszip';
import crypto from 'node:crypto';
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

const INCLUDE = {
	'LICENSE': 'license/LICENSE',
	'CHANGELOG.md': 'src/CHANGELOG.md',
	'resources/icon.png': 'res/icon.png',
	'addons/blender/io_scene_wowobj': 'addon/io_scene_wowobj',
	'src/assets/fa-icons': 'src/fa-icons',
	'src/assets/images': 'src/images',
	'src/assets/fonts': 'src/fonts'
};

const INCLUDE_CODE = {
	'src/shaders': 'src/shaders',
	'src/app/index.html': 'src/index.html',
	'src/css/app.css': 'src/app.css',
};

const REMAP = {
	'credits.html': 'license/nwjs.html',
	'nw.exe': 'wow.export.exe'
};

function copy_sync(src: string, target: string): void {
	log.info('copy_sync {%s} -> {%s}', src, target);
	const stat = fs.statSync(src);

	if (stat.isDirectory()) {
		for (const file of fs.readdirSync(src))
			copy_sync(path.join(src, file), path.join(target, file));
	} else {
		if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < stat.mtimeMs) {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.copyFileSync(src, target);
		}
	}
}

function collect_files(dir: string, entries: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir)) {
		const entryPath = path.join(dir, entry);
		if (fs.statSync(entryPath).isDirectory())
			collect_files(entryPath, entries);
		else
			entries.push(entryPath);
	}

	return entries;
}

const execute_command = (cmd: string, ...params: string[]): void => {
	cmd = util.format(cmd, ...params);
	log.info('> %s', cmd);
	execSync(cmd, { stdio: 'inherit' });
};

const argv = process.argv.slice(2).map(e => e.toLowerCase());

const isDebugBuild = argv.includes('--debug');
const buildType = isDebugBuild ? 'development' : 'production';

const buildDir = path.join('bin', isDebugBuild ? 'win-x64-debug' : 'win-x64');
log.info('Building {%s} in {%s}...', buildType, path.resolve(buildDir));

// If --code is set, update the code files in the build directory.
// Having this separate is useful for development, as we don't need to rebuild everything.
if (argv.includes('--code')) {
	const results = await Bun.build({
		entrypoints: ['./src/app/app.ts'],
		target: 'node',
		format: 'esm',
		minify: false, // Disable until better CJS/ESM support in Bun.
		define: {
			'__VUE_OPTIONS_API__': 'true', // See https://link.vuejs.org/feature-flags
			'__VUE_PROD_DEVTOOLS__': 'false', // See https://link.vuejs.org/feature-flags
			'process.env.NODE_ENV': JSON.stringify(buildType),
		}
	});

	if (results.success === false)
		throw new AggregateError(results.logs, 'Code compilation failed, see details.');

	for (const result of results.outputs) {
		let text = await result.text();

		// nw.js does not support namespaced ESM imports, so this is a fix.
		// In the future Bun will support CJS as a format, which will make this redundant.
		text = text.replaceAll(/import\s*([^\s]+)\s*from\s*"node:([a-z/_]+)";/g, 'const $1 = require("node:$2");');

		// Replace exports.hasOwnProperty(k) with false
		// This is a workaround for a bug in Vue.
		text = text.replaceAll(/exports\.hasOwnProperty\(k\)/g, 'false');

		const srcPath = path.join(buildDir, 'src', 'app.js');
		fs.mkdirSync(path.dirname(srcPath), { recursive: true });
		Bun.write(srcPath, text);
	}
}

let includes = Array<[string, string]>();

// If --code is set, update the build directory with additional code files.
if (argv.includes('--code'))
	includes = [...includes, ...Object.entries(INCLUDE_CODE)];

// If --assets is set, update the build directory with asset files.
if (argv.includes('--assets'))
	includes = [...includes, ...Object.entries(INCLUDE)];

if (includes.length > 0) {
	// Step 3: Copy additional source files.
	log.info('Updating files...');
	log.indent();

	for (const [src, dest] of includes)
		copy_sync(src, path.join(buildDir, dest));

	log.outdent();
}

// If --framework is set, update the build directory with distribution files.
if (argv.includes('--framework')) {
	// Step 4: Build nw.js distribution using `nwjs-installer'.
	// See https://github.com/Kruithne/nwjs-installer for usage information.
	log.info('Running {nwjs-installer}...');
	execute_command('nwjs-installer --target-dir "%s" --version 0.75.0 --platform win --arch x64 --remove-pak-info --locale en-US --exclude "^notification_helper.exe$"' + (isDebugBuild ? ' --sdk' : ''), buildDir);

	// Step 4: Copy and adjust the package manifest.
	log.info('Generating {package.json} for distribution...');
	const manifest = JSON.parse(fs.readFileSync('./src/config/package.json', 'utf8'));

	for (const key of ['name', 'description', 'license', 'version', 'contributors', 'bugs', 'homepage'])
		manifest[key] = (meta as Record<string, unknown>)[key];

	manifest.guid = crypto.randomUUID(); // Unique build ID for updater.
	manifest.flavour = 'win-x64' + (isDebugBuild ? '-debug' : '');

	fs.writeFileSync(path.join(buildDir, 'package.json'), JSON.stringify(manifest, null, '\t'), 'utf8');

	// Step 5: File remapping.
	log.info('Remapping build files...');
	log.indent();
	for (const [src, dest] of Object.entries(REMAP)) {
		const mapDest = path.join(buildDir, dest);
		fs.mkdirSync(path.dirname(mapDest), { recursive: true });

		fs.renameSync(path.join(buildDir, src), mapDest);
		log.success('{%s} -> {%s}', src, mapDest);
	}
	log.outdent();

	// Step 6: Run `resedit` to edit the executable metadata.
	// See https://github.com/jet2jet/resedit-js for usage information.
	log.info('Modifying PE resources for {wow.export.exe}...');
	execute_command('resedit ' + Object.entries({
		'in': path.join(buildDir, 'wow.export.exe'),
		'out': path.join(buildDir, 'wow.export.exe'),
		'icon': 'IDR_MAINFRAME,resources/icon.ico',
		'product-name': 'wow.export',
		'product-version': meta.version + '.0',
		'file-description': 'wow.export',
		'file-version': meta.version + '.0',
		'original-filename': 'wow.export.exe',
		'company-name': 'Kruithne, Marlamin, and contributors',
		'internal-name': 'wow.export'
	}).map(([key, value]) => `--${key} "${value}"`).join(' '));
}

// If --package is set, package the build into a ZIP file.
// Packages are generated to /bin/packages/*
if (argv.includes('--package')) {
	// Step 9: Package build into a ZIP file.
	const packageDir = path.join('bin', 'packages');
	if (!fs.existsSync(packageDir))
		fs.mkdirSync(packageDir, { recursive: true });

	// TODO: Name this file based on the build platform.
	const zipArchive = path.join(packageDir, 'wow.export.zip');
	log.info('Packaging build into {%s}...', zipArchive);

	const zip = new JSZip();
	const files = collect_files(buildDir);
	let totalSize = 0;

	for (const file of files) {
		const fileData = fs.readFileSync(file);
		const relative = path.posix.relative(buildDir, file);

		totalSize += fileData.length;
		zip.file(relative, fileData);
	}

	const zipData = await zip.generateAsync({ type: 'nodebuffer' });
	fs.writeFileSync(zipArchive, zipData);
	log.success('Packaged {%s} files ({%smb})', files.length, (totalSize / 1024 / 1024).toFixed(2));
}

log.outdent();