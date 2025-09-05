/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';
import zlib from 'node:zlib';
import path from 'node:path';
import util from 'node:util';
import rcedit from 'rcedit';
import crypto from 'node:crypto';
import fse from 'fs-extra';
import { rollup } from 'rollup';

const argv = process.argv.splice(2);

const CONFIG_FILE = './build.json';
const MANIFEST_FILE = './package.json';

const log_color = (color, text) => `${Bun.color(color, 'ansi_16m')}${text}\x1b[0m`;
const log_colour_array = (arr, color = 'cyan') => arr.map(e => log_color(color, e.name || e)).join(', ');

const log = {
	error: (msg, ...params) => log.print(log_color('red', 'ERR ') + msg, ...params),
	warn: (msg, ...params) => log.print(log_color('yellow', 'WARN ') + msg, ...params),
	success: (msg, ...params) => log.print(log_color('green', 'DONE ') + msg, ...params),
	info: (msg, ...params) => log.print(log_color('cyan', 'INFO ') + msg, ...params),
	print: (msg, ...params) => console.log(msg.replace(/\*([^*]+)\*/gm, (m, g1) => log_color('cyan', g1)), ...params)
};

function format_bytes(bytes) {
	if (bytes === 0)
		return '0b';

	const units = ['b', 'kb', 'mb', 'gb'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));

	// no more than gb
	const unit_index = Math.min(i, 3);

	// format with at most 2 decimal places and remove trailing zeros
	return (bytes / Math.pow(1024, unit_index)).toFixed(2)
		.replace(/\.0+$|(\.\d*[1-9])0+$/, '$1') + units[unit_index];
}

/**
 * Returns an array of all files recursively collected from a directory.
 * @param {string} dir Directory to recursively search.
 * @param {array} out Array to be populated with results (automatically created).
 */
const collectFiles = async (dir, out = []) => {
	const entries = await fs.opendir(dir);
	for await (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory())
			await collectFiles(entryPath, out);
		else
			out.push(entryPath);
	}

	return out;
};

/**
 * Removes all files with a specific extension recursively from a directory.
 * @param {string} directoryPath Directory to recursively search.
 * @param {array} targetExtension Extension of files to be removed.
 */
async function removeFilesByExtension(directoryPath, targetExtension) {
	try {
		const entries = await fs.readdir(directoryPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				await removeFilesByExtension(fullPath, targetExtension);
			} else {
				const ext = path.extname(entry.name);
				if (ext.toLowerCase() === targetExtension.toLowerCase())
					await fs.unlink(fullPath);
			}
		}
	} catch (err) {
		console.error(`Error processing directory: ${err}`);
	}
}

// Create a promisified version of zlib.deflate.
const deflateBuffer = util.promisify(zlib.deflate);

(async () => {
	const config = await Bun.file(CONFIG_FILE).json();
	const outDir = path.resolve(config.outputDirectory);
	const cacheDir = path.resolve(config.cacheDirectory);

	// Create base directories we use during the build.
	await fs.mkdir(outDir, { recursive: true });
	await fs.mkdir(cacheDir, { recursive: true });

	// Index builds from the build config.
	const builds = new Map();
	for (const build of config.builds)
		builds.set(build.name, build);

	// Check all provided CLI parameters for valid build names.
	const targetBuilds = [];
	if (argv.includes('*')) {
		// If * is present as a parameter, include all builds.
		targetBuilds.push(...builds.values());
	} else {
		for (const arg of argv) {
			const build = builds.get(arg.toLowerCase());
			if (build !== undefined)
				targetBuilds.push(build);
		}
	}

	// User has not selected any valid builds; display available and exit.
	if (targetBuilds.length === 0) {
		log.warn('You have not selected any builds.');
		log.info('Available builds: %s', log_colour_array(config.builds));
		return;
	}

	const allBuildsStart = Date.now();
	log.info('Selected builds: %s', log_colour_array(targetBuilds));

	for (const build of targetBuilds) {
		const buildGUID = Bun.randomUUIDv7();

		log.info('Starting build *%s* [guid *%s*]...', build.name, buildGUID);
		const buildStart = Date.now();
		const buildDir = path.join(outDir, build.name);

		// Wipe the build directory and then re-create it.
		await fs.rm(buildDir, { recursive: true, force: true });
		await fs.mkdir(buildDir, { recursive: true });

		const bundleArchive = util.format(build.bundle, config.webkitVersion);
		const bundlePath = path.join(cacheDir, bundleArchive);

		// Check if we already have a copy of this bundle in our cache directory.
		// If not, download it from the remote server and store it for re-use.
		await fs.access(bundlePath).catch(async () => {
			const bundleURL = util.format(config.webkitURL, config.webkitVersion, bundleArchive);
			log.info('Downloading *%s*...', bundleURL);

			const startTime = Date.now();
			const response = await fetch(bundleURL);
			if (!response.ok)
				throw new Error('Download failed: ' + response.statusText);

			const data = await response.arrayBuffer();
			await Bun.write(bundlePath, data);

			const elapsed = (Date.now() - startTime) / 1000;
			const bundleStats = await fs.stat(bundlePath);
			log.success('Download complete! *%s* in *%ds* (*%s/s*)', format_bytes(bundleStats.size), elapsed, format_bytes(bundleStats.size / elapsed));
		});

		// This function allows us to filter out files from the framework
		// bundle that we don't want included in our final output.
		const extractFilter = (entry) => {
			// Whitelist takes priority over blacklist.
			for (const check of build.filter.whitelist) {
				if (entry.match(check))
					return true;
			}

			for (const check of build.filter.blacklist) {
				if (entry.match(check))
					return false;
			}

			// Default to inclusion.
			return true;
		};

		const extractStart = Date.now();
		let extractCount = 0;
		let filterCount = 0;
		log.info('Extracting files from *%s*...', bundleArchive);

		const bundleType = build.bundleType.toUpperCase();
		if (bundleType === 'ZIP') { // 0x04034b50
			const zip = new AdmZip(bundlePath);
			const zipEntries = zip.getEntries();

			const bundleName = path.basename(bundleArchive, '.zip');
			for (const entry of zipEntries) {
				const entryName = entry.entryName;
				if (extractFilter(entryName)) {
					const entryPath = entryName.substring(bundleName.length);
					const entryDir = path.join(buildDir, path.dirname(entryPath));

					await fs.mkdir(entryDir, { recursive: true });
					zip.extractEntryTo(entryName, entryDir, false, true);
					extractCount++;
				} else {
					filterCount++;
				}
			}
		} else if (bundleType === 'GZ') { // 0x8B1F
			const list_result = Bun.spawnSync({ cmd: ['tar', '-tf', bundlePath] });
			if (list_result.exitCode !== 0)
				throw new Error(`Failed to list archive contents: ${list_result.stderr?.toString() || 'Unknown error'}`);

			const all_files = list_result.stdout?.toString().split('\n').filter(line => line.trim() && !line.endsWith('/')) || [];
			const files_to_extract = [];

			for (const file of all_files) {
				if (extractFilter(file)) {
					const stripped_path = file.split('/').slice(1).join('/');
					if (stripped_path) {
						files_to_extract.push(file);
						extractCount++;
					}
				} else {
					filterCount++;
				}
			}

			if (files_to_extract.length > 0) {
				const extract_args = [
					'-xf', bundlePath,
					'-C', buildDir,
					'--strip-components=1',
					...files_to_extract
				];

				const extract_res = Bun.spawnSync({ cmd: ['tar', ...extract_args] });
				if (extract_res.exitCode !== 0)
					throw new Error(`Extraction failed: ${extract_res.stderr?.toString() || 'Unknown error'}`);
			}
		} else {
			// Developer didn't config a build properly.
			throw new Error('Unexpected bundle type: ' + bundleType);
		}

		const extractElapsed = (Date.now() - extractStart) / 1000;
		log.success('Extracted *%d* files (*%d* filtered) in *%ds*', extractCount, filterCount, extractElapsed);

		log.info('Remapping files and merging additional sources...');
		const mappings = [];

		// File remappings: Source -and- target are relative to build directory.
		const remaps = Object.entries(build.remap || {});
		if (remaps.length > 0) {
			for (const [origName, target] of remaps)
				mappings.push({ source: path.join(buildDir, origName), target });
		}

		// Additional source merges: Source is relative to cwd, target relative to build directory.
		const include = Object.entries(build.include || {});
		if (include.length > 0) {
			for (const [source, target] of include)
				mappings.push({ source: path.resolve(source), target, clone: true });
		}

		for (const map of mappings) {
			const targetPath = path.join(buildDir, map.target);
			log.info('*%s* -> *%s*', map.source, targetPath);

			// In the event that we specify a deeper path that does not
			// exist, make sure we create missing directories first.
			await fs.mkdir(path.dirname(targetPath), { recursive: true });
			const func = map.clone ? fs.copyFile : fs.rename;
			await func(map.source, targetPath);
		}

		// Build included ZIP archives.
		const includeZip = Object.entries(build.includeZip || {});
		for (const [source, target] of includeZip) {
			log.info('Creating archive *%s* -> *%s*', source, target);
			const zip = new AdmZip();
			const targetPath = path.join(buildDir, target);

			// Create directory as needed.
			await fs.mkdir(path.dirname(targetPath), { recursive: true });

			zip.addLocalFolder(path.resolve(source), path.basename(target, '.zip'));
			zip.writeZip(targetPath);
		}

		const osxConfig = build.osxConfig;
		if (osxConfig) {
			// Adjust the CFBundleDisplayName value in the XML dict.
			const xmlPath = path.join(buildDir, osxConfig.infoXMLPath);
			let xml = await fs.readFile(xmlPath, 'utf8');
			xml =  xml.replace(/(<key>CFBundleDisplayName<\/key>\n\t<string>)([^<]+)(<\/string>)/, util.format('$1%s$3', osxConfig.CFBundleDisplayName));
			await fs.writeFile(xmlPath, xml, 'utf8');

			// Adjust the CFBundleDisplayName value in the locale string list.
			const infoPath = path.join(buildDir, osxConfig.infoStringsPath);
			let strs = await fs.readFile(infoPath, 'utf8');
			strs = strs.replace(/(CFBundleDisplayName\s=\s)("nwjs")/, util.format('$1"%s"', osxConfig.CFBundleDisplayName));
			await fs.writeFile(infoPath, strs, 'utf8');

			log.success('Modified CFBundleDisplayName value for OSX resources');
		}

		// Clone or link sources (depending on build-specific flag).
		const sourceType = build.sourceMethod.toUpperCase();
		const sourceDirectory = path.resolve(config.sourceDirectory);
		const sourceTarget = path.resolve(path.join(buildDir, build.sourceTarget));

		const isBundle = sourceType === 'BUNDLE';
		if (sourceType === 'LINK') {
			// Create a symlink for the source directory.
			await fs.symlink(sourceDirectory, sourceTarget, 'junction');
			log.success('Created source link *%s* <-> *%s*', sourceTarget, sourceDirectory);
		} else if (isBundle) {
			// Bundle everything together, packaged for production release.
			const bundleConfig = build.bundleConfig;
			const preBuildDir = path.join(outDir, '_prebuild');
			await fs.rm(preBuildDir, { recursive: true, force: true });
			await fs.mkdir(preBuildDir, { recursive: true });
			await fse.copy(sourceDirectory, preBuildDir, { overwrite: true });
			const rollupBundle = await rollup({input: path.join(sourceDirectory, bundleConfig.jsEntry.replace('.js', '.mjs'))});
			await rollupBundle.write({
				file: path.join(preBuildDir, bundleConfig.jsEntry),
				format: 'cjs',
				inlineDynamicImports: true,
			});
			removeFilesByExtension(preBuildDir, '.mjs');

			const jsEntry = path.join(preBuildDir, bundleConfig.jsEntry);
			log.info('Bundling sources (entry: *%s*)...', jsEntry);

			// Make sure the source directory exists.
			await fs.mkdir(sourceTarget, { recursive: true });

			const out_build = await Bun.build({
				entrypoints: [jsEntry],
				outdir: sourceTarget,
				target: 'node',
				format: 'cjs',
				define: {
					'process.env.BUILD_RELEASE': '"true"'
				}
			});

			for (const output of out_build.outputs)
				log.success('Created bundle *%s*', output.hash);
		}

		if (sourceType === 'CLONE' || isBundle) {
			const filterExt = isBundle ? build.bundleConfig.filterExt || [] : [];

			// Clone all of the sources files to the build output.
			log.info('Cloning sources *%s* -> *%s*...', sourceDirectory, sourceTarget);
			const cloneStart = Date.now();

			await fs.mkdir(sourceTarget, { recursive: true });
			const files = await collectFiles(sourceDirectory);
			for (const file of files) {
				if (isBundle && filterExt.some(e => file.endsWith(e)))
					continue;

				const targetPath = path.join(sourceTarget, path.relative(sourceDirectory, file));
				await fs.mkdir(path.dirname(targetPath), { recursive: true });
				await fs.copyFile(file, targetPath);
			}

			const cloneElapsed = (Date.now() - cloneStart) / 1000;
			log.success('Cloned *%d* source files in *%ds*', files.length, cloneElapsed);
		}

		// Grab the contents of the project manifest file.
		const meta = JSON.parse(await fs.readFile(MANIFEST_FILE));

		// Set resource strings for the Windows binary.
		if (build.rcedit) {
			const rcConfig = Object.assign({
				'file-version': meta.version,
				'product-version': meta.version
			}, build.rcedit);

			log.info('Writing resource strings on binary...');
			await rcedit(path.join(buildDir, rcConfig.binary), rcConfig);
		}

		// Compile updater application.
		if (build.updater) {
			const updaterStart = Date.now();
			const updaterOutput = path.join(buildDir, build.updater.out);

			log.info('Compiling updater application (*%s*)...', build.updater.target);

			const bunArgs = [
				'build',
				config.updaterScript,
				'--compile',
				'--target=' + build.updater.target,
				'--outfile',
				updaterOutput
			];

			const result = Bun.spawnSync({ cmd: ['bun', ...bunArgs], stdio: ['inherit', 'inherit', 'inherit'] });
			if (result.exitCode !== 0)
				throw new Error(`Bun build failed with code ${result.exitCode}`);

			const updaterElapsed = (Date.now() - updaterStart) / 1000;
			log.success('Updater application compiled in *%ds* -> *%s*', updaterElapsed, updaterOutput);
		}

		// Build a manifest (package.json) file for the build.
		const manifest = {};

		// Apply manifest properties inherited from this scripts manifest.
		for (const inherit of config.manifestInherit || [])
			manifest[inherit] = meta[inherit];

		// Apply manifest properties defined in the config.
		Object.assign(manifest, config.manifest);

		// Apply custom build manifest
		Object.assign(manifest, build.manifest || {});

		// Apply build specific meta data to the manifest.
		Object.assign(manifest, { flavour: build.name, guid: buildGUID });

		const manifestPath = path.resolve(path.join(buildDir, build.manifestTarget));
		await fs.writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
		log.success('Manifest file written to *%s*', manifestPath);

		// Create update bundle and manifest.
		if (build.updateBundle) {
			log.info('Building update package...');

			const contents = {};
			const bundleOut = path.join(buildDir, build.updateBundle.bundle);
			const files = await collectFiles(buildDir);

			let entryCount = 0;
			let totalSize = 0;
			let compSize = 0;

			for (const file of files) {
				const relative = path.relative(buildDir, file).replace(/\\/g, '/');

				const data = await fs.readFile(file);
				const hash = crypto.createHash('sha256');
				hash.update(data);

				const comp = await deflateBuffer(data);
				await fs.writeFile(bundleOut, comp, { flag: 'a' });

				contents[relative] = { hash: hash.digest('hex'), size: data.byteLength, compSize: comp.byteLength, ofs: compSize };
				totalSize += data.byteLength;
				compSize += comp.byteLength;

				entryCount++;
			}

			const manifestData = { contents, guid: buildGUID };
			const manifestOut = path.join(buildDir, build.updateBundle.manifest);
			await fs.writeFile(manifestOut, JSON.stringify(manifestData, null, '\t'), 'utf8');
			log.info('Update package built (*%s* (*%s* deflated) in *%d* files)', format_bytes(totalSize), format_bytes(compSize), entryCount);
		}

		const buildElapsed = (Date.now() - buildStart) / 1000;
		log.success('Build *%s* completed in *%ds*', build.name, buildElapsed);
	}

	const allBuildsElapsed = (Date.now() - allBuildsStart) / 1000;
	log.success('*%d* builds completed in *%ds*!', targetBuilds.length, allBuildsElapsed);
})().catch(e => {
	log.error('An unexpected error has halted the build:');
	log.error(e);
	process.exit(1);
});