/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Author: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const tar = require('tar');
const path = require('path');
const util = require('util');
const chalk = require('chalk');
const request = require('request');
const filesize = require('filesize');
const argv = process.argv.splice(2);

const CONFIG_FILE = './build.conf';
const MANIFEST_FILE = './package.json';

const log = {
    error: (msg, ...params) => log.print(chalk.red('ERR ') + msg, ...params),
    warn: (msg, ...params) => log.print(chalk.yellow('WARN ') + msg, ...params),
    success: (msg, ...params) => log.print(chalk.green('DONE ') + msg, ...params),
    info: (msg, ...params) => log.print(chalk.blue('INFO ') + msg, ...params),
    print: (msg, ...params) => console.log(msg.replace(/\*([^\*]+)\*/gm, (m, g1) => chalk.cyan(g1)), ...params)
};

/**
 * Create all directories in a given path if they do not exist.
 * @param {string} dir Directory path.
 */
const createDirectory = async (dir) => {
    await fsp.access(dir).catch(async () => {
        await fsp.mkdir(dir, { recursive: true });
    });
};

/**
 * Returns an array of all files recursively collected from a directory.
 * @param {string} dir Directory to recursively search.
 * @param {array} out Array to be populated with results (automatically created).
 */
const collectFiles = async (dir, out = []) => {
    const entries = await fsp.opendir(dir);
    for await (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory())
            await collectFiles(entryPath, out);
        else
            out.push(entryPath);
    }

    return out;
};

(async () => {
    const config = JSON.parse(await fsp.readFile(CONFIG_FILE));
    const outDir = path.resolve(config.outputDirectory);
    const cacheDir = path.resolve(config.cacheDirectory);

    // Create base directories we use during the build.
    await createDirectory(outDir);
    await createDirectory(cacheDir);

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
        log.info('Available builds: %s', config.builds.map(e => chalk.cyan(e.name)).join(', '));
        return;
    }

    log.info('Selected builds: %s', targetBuilds.map(e => chalk.cyan(e.name)).join(', '));

    for (const build of targetBuilds) {
        log.info('Starting build *%s*...', build.name);
        const buildStart = Date.now();
        const buildDir = path.join(outDir, build.name);

        // Wipe the build directory and then re-create it.
        await fsp.rmdir(buildDir, { recursive: true });
        await createDirectory(buildDir);

        const bundleArchive = util.format(build.bundle, config.webkitVersion);
        const bundlePath = path.join(cacheDir, bundleArchive);

        // Check if we already have a copy of this bundle in our cache directory.
        // If not, download it from the remote server and store it for re-use.
        await fsp.access(bundlePath).catch(async () => {
            const bundleURL = util.format(config.webkitURL, config.webkitVersion, bundleArchive);
            log.info('Downloading *%s*...', bundleURL);

            const startTime = Date.now();
            await new Promise(resolve => request(bundleURL).pipe(fs.createWriteStream(bundlePath)).on('finish', resolve));

            const elapsed = (Date.now() - startTime) / 1000;
            const bundleStats = await fsp.stat(bundlePath);
            log.success('Download complete! *%s* in *%ds* (*%s/s*)', filesize(bundleStats.size), elapsed, filesize(bundleStats.size / elapsed));
        });

        // This function allows us to filter out files from the framework
        // bundle that we don't want included in our final output.
        const filter = config.webkitFilter;
        const extractFilter = (entry) => {
            // Whitelist takes priority over blacklist.
            for (const check of filter.whitelist)
                if (entry.match(check))
                    return true;

            for (const check of filter.blacklist)
                if (entry.match(check))
                    return false;

            // Default to inclusion.
            return true;
        };

        const extractStart = Date.now();
        let extractCount = 0;
        log.info('Extracting files from *%s*...', bundleArchive);

        const bundleType = build.bundleType.toUpperCase();
        if (bundleType === 'ZIP') { // 0x04034b50
            const zip = new AdmZip(bundlePath);
            const zipEntries = zip.getEntries();

            const bundleName = path.basename(bundleArchive, '.zip');
            for (const entry of zipEntries) {
                const entryName = entry.entryName;
                if (extractFilter(entryName)) {
                    const entryPath = entryName.substr(bundleName.length);
                    const entryDir = path.join(buildDir, path.dirname(entryPath));
    
                    await createDirectory(entryDir);
                    zip.extractEntryTo(entryName, entryDir, false, true);
                    extractCount++;
                } else {
                    log.warn('Skipping extraction of *%s* due to filter!', entryName);
                }
            }
        } else if (bundleType === 'GZ') { // 0x8B1F
            await tar.x({ file: bundlePath, cwd: buildDir, strip: 1, filter: (path) => {
                if (!extractFilter(path)) {
                    log.warn('Skipping extraction of *%s* due to filter!', path);
                    return false;
                }

                extractCount++;
                return true;
            }});
        } else {
            // Developer didn't config a build properly.
            throw new Error('Unexpected bundle type: ' + bundleType);
        }

        const extractElapsed = (Date.now() - extractStart) / 1000;
        log.success('Extracted *%d* files in *%ds*', extractCount, extractElapsed);

        // Clone or link sources (depending on build-specific flag).
        const sourceType = build.sourceMethod.toUpperCase();
        const sourceDirectory = path.resolve(config.sourceDirectory);
        const sourceTarget = path.resolve(path.join(buildDir, config.sourceDirectory));

        if (sourceType === 'LINK') {
            // Create a symlink for the source directory.
            await fsp.symlink(sourceDirectory, sourceTarget, 'junction');
            log.success('Created source link *%s* <-> *%s*', sourceTarget, sourceDirectory);
        } else if (sourceType === 'CLONE') {
            // Clone all of the sources files to the build output.
            log.info('Cloning sources *%s* -> *%s*...', sourceDirectory, sourceTarget);
            const cloneStart = Date.now();

            await createDirectory(sourceTarget);
            const files = await collectFiles(sourceDirectory);
            for (const file of files) {
                const targetPath = path.join(sourceTarget, path.relative(sourceDirectory, file));
                await createDirectory(path.dirname(targetPath));
                await fsp.copyFile(file, targetPath);
            }

            const cloneElapsed = (Date.now() - cloneStart) / 1000;
            log.success('Cloned *%d* source files in *%ds*', files.length, cloneElapsed);
        }

        // ToDo: Minify/merge sources (controlled by per-build flag).

        // Build a manifest (package.json) file for the build.
        const meta = JSON.parse(await fsp.readFile(MANIFEST_FILE));
        const manifest = {};

        // Apply manifest properties inherited from this scripts manifest.
        for (const inherit of config.manifestInherit || [])
            manifest[inherit] = meta[inherit];

        // Apply manifest properties defined in the config.
        Object.assign(manifest, config.manifest);

        const manifestPath = path.resolve(path.join(buildDir, MANIFEST_FILE));
        await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
        log.success('Manifest file written to *%s*', manifestPath);

        const buildElapsed = (Date.now() - buildStart) / 1000;
        log.success('Build *%s* completed in *%ds*', build.name, buildElapsed);
    }
})().catch(e => {
    log.error('An unexpected error has halted the build:');
    log.error(e.toString());
});