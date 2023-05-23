import meta from './package.json';
import log from '@kogs/logger';
import { execSync } from 'child_process';
import { copySync, collectFiles } from '@kogs/utils';
import { parse } from '@kogs/argv';
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
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

try {
	const run = (cmd: string, ...params: string[]): void => {
		cmd = util.format(cmd, ...params);
		log.info('> %s', cmd);
		execSync(cmd, { stdio: 'inherit' });
	};

	const argv = parse();

	const isDebugBuild = argv.options.asBoolean('debug');
	const buildType = isDebugBuild ? 'development' : 'production';

	const buildDir = path.join('bin', isDebugBuild ? 'win-x64-debug' : 'win-x64');
	log.info('Building {%s} in {%s}...', buildType, path.resolve(buildDir));

	// If --code is set, update the code files in the build directory.
	// Having this separate is useful for development, as we don't need to rebuild everything.
	if (argv.options.asBoolean('code')) {
		const results = await Bun.build({
			entrypoints: ['./src/app/app.ts'],
			target: 'node',
			format: 'esm',
			minify: !isDebugBuild,
			define: {
				'__VUE_OPTIONS_API__': 'true', // See https://link.vuejs.org/feature-flags
				'__VUE_PROD_DEVTOOLS__': 'false', // See https://link.vuejs.org/feature-flags
				'process.env.NODE_ENV': JSON.stringify(buildType),
			}
		});

		for (const result of results.outputs) {
			let text = await result.text();

			// nw.js does not support namespaced ESM imports, so this is a fix.
			// In the future Bun will support CJS as a format, which will make this redundant.
			text = text.replace(/import\s+(\w+)\s+from\s+"node:([a-z/_]+)";/g, 'const $1 = require("node:$2");');

			// Replace exports.hasOwnProperty(k) with false
			// This is a workaround for a bug in Vue.
			text = text.replace(/exports\.hasOwnProperty\(k\)/g, 'false');

			Bun.write(path.join(buildDir, 'src', 'app.js'), text);
		}
	}

	let includes = Array<[string, string]>();

	// If --code is set, update the build directory with additional code files.
	if (argv.options.asBoolean('code'))
		includes = [...includes, ...Object.entries(INCLUDE_CODE)];

	// If --assets is set, update the build directory with asset files.
	if (argv.options.asBoolean('assets'))
		includes = [...includes, ...Object.entries(INCLUDE)];

	if (includes.length > 0) {
		// Step 3: Copy additional source files.
		log.info('Copying files...');
		log.indent();

		for (const [src, dest] of includes) {
			const includeDest = path.join(buildDir, dest);
			fs.mkdirSync(path.dirname(includeDest), { recursive: true });

			copySync(src, includeDest, { overwrite: 'newer' });
			log.success('{%s} -> {%s}', src, includeDest);
		}
		log.outdent();
	}

	// If --framework is set, update the build directory with distribution files.
	if (argv.options.asBoolean('framework')) {
		// Step 4: Build nw.js distribution using `nwjs-installer'.
		// See https://github.com/Kruithne/nwjs-installer for usage information.
		log.info('Running {nwjs-installer}...');
		run('nwjs --target-dir "%s" --version 0.76.1 --platform win --arch x64 --remove-pak-info --locale en-US --exclude "^notification_helper.exe$"' + (isDebugBuild ? ' --sdk' : ''), buildDir);

		// Step 4: Copy and adjust the package manifest.
		log.info('Generating {package.json} for distribution...');
		const manifest = JSON.parse(fs.readFileSync('./src/config/package.json', 'utf8'));
		for (const key of ['name', 'description', 'license', 'version', 'contributors', 'bugs', 'homepage'])
			manifest[key] = meta[key];

		manifest.guid = uuidv4(); // Unique build ID for updater.
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
		run('resedit ' + Object.entries({
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

		// Step 7: Build updater executable, bundle and manifest (release builds only).
		if (!isDebugBuild) {
			// Step 7.1: Compile updater executable using `pkg`.
			// See https://github.com/vercel/pkg for usage information.
			log.info('Compiling {updater.exe}...');
			run('pkg --target node12-win-x64 --output "%s" "%s"', path.join(buildDir, 'updater.exe'), path.join('src', 'updater', 'updater.js'));

			// Step 7.1.1: Reuse the PE modification code from above to edit the updater executable.
			// Import that we use the --no-grow option here as `pkg` relies on the executable being a fixed size.
			log.info('Modifying PE resources for {updater.exe}...');
			run('resedit --no-grow ' + Object.entries({
				'in': path.join(buildDir, 'updater.exe'),
				'out': path.join(buildDir, 'updater.exe'),
				'icon': '1,resources/icon.ico',
				'product-name': 'wow.export',
				'product-version': meta.version + '.0',
				'file-description': 'wow.export',
				'file-version': '2.0.0.0',
				'original-filename': 'wow.export.exe',
				'company-name': 'Kruithne, Marlamin, and contributors',
				'internal-name': 'wow.export'
			}).map(([key, value]) => `--${key} "${value}"`).join(' '));
		}
	}

	// If --update is set, generate the files used by the update server.
	// These files will generate to /bin/update/* and are not included in the final package.
	if (argv.options.asBoolean('update')) {
		// Step 8: Compile update file/manifest.
		log.info('Writing update package...');

		const updateManifest = {};
		const updateFiles = await collectFiles(buildDir);
		const updateDir = path.join('bin', 'update');

		let entryCount = 0;
		let totalSize = 0;
		let compSize = 0;

		for (const file of updateFiles) {
			const relative = path.posix.relative(buildDir, file);
			const data = fs.readFileSync(file);
			const hash = crypto.createHash('sha256').update(data).digest('hex');

			const dataCompressed = zlib.deflateSync(data);
			fs.writeFileSync(path.join(updateDir, 'update'), dataCompressed, { flag: 'a' });

			updateManifest[relative] = { hash, size: data.length, compSize: dataCompressed.length, ofs: compSize };
			totalSize += data.length;
			compSize += dataCompressed.length;

			entryCount++;
		}

		const manifest = JSON.parse(fs.readFileSync('./src/config/package.json', 'utf8'));
		const manifestData = { contents: updateManifest, guid: manifest.guid };
		fs.writeFileSync(path.join(updateDir, 'update.json'), JSON.stringify(manifestData, null, '\t'), 'utf8');

		const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
		const compSizeMB = (compSize / 1024 / 1024).toFixed(2);
		log.success('Compressed update package with {%s} entries ({%smb} => {%smb})', entryCount, totalSizeMB, compSizeMB);
	}

	// If --package is set, package the build into a ZIP file.
	// Packages are generated to /bin/packages/*
	if (argv.options.asBoolean('package')) {
		// Step 9: Pacakge build into a ZIP file.
		const zipArchive = path.join('bin', 'packages', 'wow.export-' + meta.version + '.zip');
		log.info('Packaging build into {%s}...', zipArchive);

		const zip = new JSZip();
		const files = await collectFiles(buildDir);
		let totalSize = 0;

		for (const file of files) {
			const filePath = path.join(buildDir, file);
			const fileData = fs.readFileSync(filePath);

			totalSize += fileData.length;
			zip.file(file, fileData);
		}

		const zipData = await zip.async({ type: 'nodebuffer' });
		fs.writeFileSync(zipArchive, zipData);
		log.success('Packaged {%s} files ({%smb})', files.length, (totalSize / 1024 / 1024).toFixed(2));
	}

	log.outdent();
} catch (err) {
	log.error('{Failed} %s: ' + err.message, err.name);
}