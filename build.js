const fs = require('fs');
const fsp = fs.promises;
const AdmZip = require('adm-zip');
const path = require('path');
const util = require('util');
const chalk = require('chalk');
const request = require('request');
const filesize = require('filesize');
const argv = process.argv.splice(2);

const CONFIG_FILE = path.resolve('./build.conf');

const log = {
    error: (msg, ...params) => log.print(chalk.red('ERR ') + msg, ...params),
    warn: (msg, ...params) => log.print(chalk.yellow('WARN ') + msg, ...params),
    success: (msg, ...params) => log.print(chalk.green('DONE ') + msg, ...params),
    info: (msg, ...params) => log.print(chalk.blue('INFO ') + msg, ...params),
    print: (msg, ...params) => console.log(msg.replace(/\*([^\*]+)\*/gm, (m, g1) => chalk.cyan(g1)), ...params)
};

const createDirectory = async (dir) => {
    await fsp.access(dir).catch(async () => {
        await fsp.mkdir(dir, { recursive: true });
    });
};

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
    for (const arg of argv) {
        const build = builds.get(arg.toLowerCase());
        if (build !== undefined)
            targetBuilds.push(build);
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

        // Download the bundle if it does not yet exist.
        await fsp.access(bundlePath).catch(async () => {
            const bundleURL = util.format(config.webkitURL, config.webkitVersion, bundleArchive);
            log.info('Downloading *%s*...', bundleURL);

            const startTime = Date.now();
            await new Promise(resolve => request(bundleURL).pipe(fs.createWriteStream(bundlePath)).on('finish', resolve));

            const elapsed = (Date.now() - startTime) / 1000;
            const bundleStats = await fsp.stat(bundlePath);
            log.success('Download complete! *%s* in *%ds* (*%s/s*)', filesize(bundleStats.size), elapsed, filesize(bundleStats.size / elapsed));
        });

        // Extract framework from the bundle.
        const zip = new AdmZip(bundlePath);
        const zipEntries = zip.getEntries();

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
        log.info('Extracting files from *%s*...', bundleArchive);

        // ToDo: Unify this reduction to support other archive types.
        const bundleName = path.basename(bundleArchive, '.zip');
        for (const entry of zipEntries) {
            const entryName = entry.entryName;
            if (extractFilter(entryName)) {
                const entryPath = entryName.substr(bundleName.length);
                const entryDir = path.join(buildDir, path.dirname(entryPath));

                await createDirectory(entryDir);
                zip.extractEntryTo(entryName, entryDir, false, true);
            } else {
                log.warn('Skipping extraction of *%s* due to filter!', entryName);
            }
        }

        const extractElapsed = (Date.now() - extractStart) / 1000;
        log.success('Extracted *%d* files in *%ds*', zipEntries.length, extractElapsed);

        // Clone or link sources (depending on build-specific flag).
        const sourceType = build.sourceMethod.toUpperCase();
        const sourceDirectory = path.resolve(config.sourceDirectory);
        const sourceTarget = path.resolve(path.join(buildDir, config.sourceDirectory));

        if (sourceType === 'LINK') {
            await fsp.symlink(sourceDirectory, sourceTarget, 'junction');
            log.success('Created source link *%s* <-> *%s*', sourceTarget, sourceDirectory);
        } else if (sourceType === 'CLONE') {
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

        const buildElapsed = (Date.now() - buildStart) / 1000;
        log.success('Build *%s* completed in *%ds*', build.name, buildElapsed);
    }
})().catch(e => {
    log.error('An unexpected error has halted the build:');
    log.error(e.toString());
});