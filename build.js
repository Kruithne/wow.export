/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
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
const rcedit = require('rcedit');
const acorn = require('acorn');
const builtin = require('module');
const terser = require('terser');
const sass = require('node-sass');
const uuid = require('uuid/v4');
const crypto = require('crypto');
const argv = process.argv.splice(2);
const pkg = require('pkg');

const CONFIG_FILE = './build.conf';
const MANIFEST_FILE = './package.json';

const AST_NO_MATCH = Symbol('astNoMatch');
const AST_REQUIRE_VAR_STRUCT = {
    type: 'VariableDeclaration',
    declarations: {
        type: 'VariableDeclarator',
        id: {
            type: 'Identifier'
        },
        init: {
            type: 'CallExpression',
            start: 'EXPORT',
            end: 'EXPORT',
            callee: {
                type: 'Identifier',
                name: 'require'
            },
            arguments: {
                type: 'Literal',
                value: 'EXPORT'
            }
        }
    }
};

const AST_REQUIRE_EXP_STRUCT = {
    type: 'ExpressionStatement',
    start: 'EXPORT',
    end: 'EXPORT',
    expression: {
        type: 'CallExpression',
        callee: {
            type: 'Identifier',
            name: 'require'
        },
        arguments: {
            type: 'Literal',
            value: 'EXPORT'
        }
    }
};

const AST_EXPORT_STRUCT = {
    type: 'ExpressionStatement',
    expression: {
        type: 'AssignmentExpression',
        operator: '=',
        start: 'EXPORT',
        end: 'EXPORT',
        left: {
            type: 'MemberExpression',
            object: {
                type: 'Identifier',
                name: 'module'
            },
            property: {
                type: 'Identifier',
                name: 'exports'
            }
        },
        right: 'EXPORT'
    }
};

const log = {
    error: (msg, ...params) => log.print(chalk.red('ERR ') + msg, ...params),
    warn: (msg, ...params) => log.print(chalk.yellow('WARN ') + msg, ...params),
    success: (msg, ...params) => log.print(chalk.green('DONE ') + msg, ...params),
    info: (msg, ...params) => log.print(chalk.blue('INFO ') + msg, ...params),
    print: (msg, ...params) => console.log(msg.replace(/\*([^\*]+)\*/gm, (m, g1) => chalk.cyan(g1)), ...params)
};

/**
 * Provides a wrapper for applying consecutive substitutions to a single
 * string using the original offsets before any changes were made.
 * @class DynamicString
 */
class DynamicString {
    constructor(str) {
        this._str = str;
        this._mods = [];
    }

    _addOffset(idx, ofs) {
        this._mods.push({ idx, ofs });
    }

    get(start, end) {
        // Adjust the offsets relative to all applied changes.
        for (const mod of this._mods) {
            if (start >= mod.idx) {
                start += mod.ofs;
                end += mod.ofs;
            }
        }

        return this._str.substring(start, end);
    }

    sub(start, end, sub) {
        // Adjust the offsets relative to all applied changes.
        for (const mod of this._mods) {
            if (start >= mod.idx) {
                start += mod.ofs;
                end += mod.ofs;
            }
        }

        const repl = this._str.substring(0, start) + sub + this._str.substring(end);
        const origLength = end - start;

        if (sub.length !== origLength)
            this._addOffset(end, sub.length - origLength);

        this._str = repl;
    }

    toString() {
        return this._str;
    }
}

/**
 * Calculate the hash of a file.
 * @param {string} file Path to the file to hash.
 * @param {string} method Hashing method.
 * @param {string} encoding Output encoding.
 */
const getFileHash = async (file, method, encoding) => {
    return new Promise(resolve => {
        const fd = fs.createReadStream(file);
        const hash = crypto.createHash(method);
        
        fd.on('data', chunk => hash.update(chunk));
        fd.on('end', () => resolve(hash.digest(encoding)));
    });
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

/**
 * Check if an AST node matches a structure.
 * Returns AST_NO_MATCH or an object containing exports.
 * @param {object} target 
 * @param {object} struct 
 * @param {object} out 
 */
const matchAST = (target, struct, out = {}) => {
    for (const [key, value] of Object.entries(struct)) {
        const node = target[key];
        const valueType = typeof value;

        // Target AST node is missing a required property completely.
        if (node === undefined)
            return AST_NO_MATCH;

        // Export the value of this property.
        if (value === 'EXPORT') {
            out[key] = target[key];
            continue;
        }

        // Primitive types need to be a 1:1 match to pass.
        if (valueType === 'string' || valueType === 'number') {
            if (value !== node)
                return AST_NO_MATCH;

            continue;
        }

        // For arrays, at least one of the items needs to match the value structure.
        if (Array.isArray(node)) {
            let subMatch = false;
            for (const subNode of node) {
                if (matchAST(subNode, value, out) !== AST_NO_MATCH) {
                    subMatch = true;
                    continue;
                }
            }

            if (!subMatch)
                return AST_NO_MATCH;

            continue;
        }

        // For normal objects just shift down a level in the tree.
        if (node !== null && valueType === 'object') {
            if (matchAST(node, value, out) !== AST_NO_MATCH)
                continue;

            return AST_NO_MATCH;
        }

        // No matches? No pass.
        return AST_NO_MATCH;
    }

    return out;
};

/**
 * Parse a source module for imports.
 * @param {string} mod 
 */
const parseModule = async (mod) => {
    const out = {
        path: path.resolve(mod),
        data: await fsp.readFile(mod, 'utf8'),
        modules: [],
        isRoot: false
    };

    const ast = acorn.parse(out.data);
    for (const node of ast.body) {
        // Locate modules imported using require() as variables or expressions.
        let importMatch = matchAST(node, AST_REQUIRE_VAR_STRUCT);

        // Node is not a require() variable, check for expression instead.
        if (importMatch === AST_NO_MATCH)
            importMatch = matchAST(node, AST_REQUIRE_EXP_STRUCT);
        else
            importMatch.isVariable = true;

        if (importMatch !== AST_NO_MATCH) {
            // Only process the module if it's not a builtin.
            if (!builtin.builtinModules.includes(importMatch.value)) {
                importMatch.value = require.resolve(path.join(path.dirname(out.path), importMatch.value));
                out.modules.push(importMatch);
            }
        }

        // Location modules exported using module.exports
        const exportMatch = matchAST(node, AST_EXPORT_STRUCT);
        if (exportMatch !== AST_NO_MATCH)
            out.export = exportMatch;
    }

    return out;
};

/**
 * Build a module tree starting from the entry-point.
 * @param {string} entry 
 * @param {array} out 
 */
const buildModuleTree = async (entry, out = [], root = true) => {
    const mod = await parseModule(entry);
    mod.isRoot = root;
    out.unshift(mod);

    for (const sub of mod.modules) {
        const subIndex = out.findIndex(e => e.path === sub.value);
        if (subIndex > -1) {
            // This module already exists in the stack, move it to the top.
            out.unshift(out.splice(subIndex, 1)[0]);
        } else {
            // Unseen module, parse it.
            await buildModuleTree(sub.value, out, false);
        }
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

    const allBuildsStart = Date.now();
    log.info('Selected builds: %s', targetBuilds.map(e => chalk.cyan(e.name)).join(', '));

    for (const build of targetBuilds) {
        const buildGUID = uuid();

        log.info('Starting build *%s* [guid *%s*]...', build.name, buildGUID);
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
        const extractFilter = (entry) => {
            // Whitelist takes priority over blacklist.
            for (const check of build.filter.whitelist)
                if (entry.match(check))
                    return true;

            for (const check of build.filter.blacklist)
                if (entry.match(check))
                    return false;

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
                    const entryPath = entryName.substr(bundleName.length);
                    const entryDir = path.join(buildDir, path.dirname(entryPath));
    
                    await createDirectory(entryDir);
                    zip.extractEntryTo(entryName, entryDir, false, true);
                    extractCount++;
                } else {
                    filterCount++;
                }
            }
        } else if (bundleType === 'GZ') { // 0x8B1F
            await tar.x({ file: bundlePath, cwd: buildDir, strip: 1, filter: (path) => {
                const filter = extractFilter(path);
                filter ? extractCount++ : filterCount++;
                return filter;
            }});
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
        if (remaps.length > 0)
            for (const [origName, target] of remaps)
                mappings.push({ source: path.join(buildDir, origName), target });

        // Additional source merges: Source is relative to cwd, target relative to build directory.
        const include = Object.entries(build.include || {});
        if (include.length > 0)
            for (const [source, target] of include)
                mappings.push({ source: path.resolve(source), target, clone: true });

        for (const map of mappings) {
            const targetPath = path.join(buildDir, map.target);
            log.info('*%s* -> *%s*', map.source, targetPath);

            // In the event that we specify a deeper path that does not
            // exist, make sure we create missing directories first.
            await createDirectory(path.dirname(targetPath));
            const func = map.clone ? fsp.copyFile : fsp.rename;
            await func(map.source, targetPath);
        }

        const osxConfig = build.osxConfig;
        if (osxConfig) {
            // Adjust the CFBundleDisplayName value in the XML dict.
            const xmlPath = path.join(buildDir, osxConfig.infoXMLPath);
            let xml = await fsp.readFile(xmlPath, 'utf8');
            xml =  xml.replace(/(<key>CFBundleDisplayName<\/key>\n\t<string>)([^<]+)(<\/string>)/, util.format('$1%s$3', osxConfig.CFBundleDisplayName));
            await fsp.writeFile(xmlPath, xml, 'utf8');

            // Adjust the CFBundleDisplayName value in the locale string list.
            const infoPath = path.join(buildDir, osxConfig.infoStringsPath);
            let strs = await fsp.readFile(infoPath, 'utf8');
            strs = strs.replace(/(CFBundleDisplayName\s=\s)("nwjs")/, util.format('$1"%s"', osxConfig.CFBundleDisplayName));
            await fsp.writeFile(infoPath, strs, 'utf8');

            log.success('Modified CFBundleDisplayName value for OSX resources');
        }

        // Clone or link sources (depending on build-specific flag).
        const sourceType = build.sourceMethod.toUpperCase();
        const sourceDirectory = path.resolve(config.sourceDirectory);
        const sourceTarget = path.resolve(path.join(buildDir, build.sourceTarget));

        const isBundle = sourceType === 'BUNDLE';
        if (sourceType === 'LINK') {
            // Create a symlink for the source directory.
            await fsp.symlink(sourceDirectory, sourceTarget, 'junction');
            log.success('Created source link *%s* <-> *%s*', sourceTarget, sourceDirectory);
        } else if (isBundle) {
            // Bundle everything together, packaged for production release.
            const bundleConfig = build.bundleConfig;
            const jsEntry = path.join(sourceDirectory, bundleConfig.jsEntry);
            log.info('Bundling sources (entry: *%s*)...', jsEntry);

            // Make sure the source directory exists.
            await createDirectory(sourceTarget);

            const moduleTree = await buildModuleTree(jsEntry);

            // Assign every module a globally unique ID to prevent any variable collision.
            // The actual value doesn't matter since it will be minified later. We also
            // calculate the overall size of all code pre-merge/minification here.
            let moduleID = 0;
            let rawSize = 0;
            const moduleMap = new Map();
            for (const mod of moduleTree) {
                mod.id = '_MOD_' + moduleID++;
                moduleMap.set(mod.path, mod.id);
                rawSize += mod.data.length;
            }

            for (const mod of moduleTree) {
                // Replace all import statements with ID assignments.
                const data = new DynamicString(mod.data);
                for (const sub of mod.modules) {
                    if (sub.isVariable)
                        data.sub(sub.start, sub.end, moduleMap.get(sub.value));
                    else
                        data.sub(sub.start, sub.end, '');
                }

                // Replace module export statements.
                if (mod.export) {
                    const ex = mod.export;
                    const exportStatement = data.get(ex.right.start, ex.right.end);
                    data.sub(ex.start, ex.end, 'return ' + exportStatement);
                }

                // Wrap modules in self-executing function.
                mod.data = '(() => {\n' + data.toString() + '\n})();';

                // Everything except for the entry-point needs to be accessible.
                if (!mod.isRoot)
                    mod.data = 'const ' + mod.id + ' = ' + mod.data;
            }

            const merged = moduleTree.map(e => e.data).join('\n');
            const minified = terser.minify(merged, config.terserConfig);

            if (minified.error)
                throw minified.error;
            
            await fsp.writeFile(path.join(sourceTarget, bundleConfig.jsEntry), minified.code, 'utf8');
            log.success('*%d* sources bundled *%s* -> *%s* (*%d%*)', moduleTree.length, filesize(rawSize), filesize(minified.code.length), 100 - Math.round((minified.code.length / rawSize) * 100));

            // Compile SCSS files into a single minified CSS output.
            const sassEntry = path.join(sourceDirectory, bundleConfig.sassEntry);
            log.info('Compiling stylesheet (entry: *%s*)...', sassEntry);

            const sassBuild = await util.promisify(sass.render)({
                file: sassEntry,
                outputStyle: 'compressed'
            });

            await fsp.writeFile(path.join(sourceTarget, bundleConfig.sassOut), sassBuild.css, 'utf8');
            log.success('Compiled stylesheet (*%d* files) in *%ds*', sassBuild.stats.includedFiles.length, sassBuild.stats.duration / 1000);
        }

        if (sourceType === 'CLONE' || isBundle) {
            const filterExt = isBundle ? build.bundleConfig.filterExt || [] : [];

            // Clone all of the sources files to the build output.
            log.info('Cloning sources *%s* -> *%s*...', sourceDirectory, sourceTarget);
            const cloneStart = Date.now();

            await createDirectory(sourceTarget);
            const files = await collectFiles(sourceDirectory);
            for (const file of files) {
                if (isBundle && filterExt.some(e => file.endsWith(e)))
                    continue;

                const targetPath = path.join(sourceTarget, path.relative(sourceDirectory, file));
                await createDirectory(path.dirname(targetPath));
                await fsp.copyFile(file, targetPath);
            }

            const cloneElapsed = (Date.now() - cloneStart) / 1000;
            log.success('Cloned *%d* source files in *%ds*', files.length, cloneElapsed);
        }

        // Grab the contents of the project manifest file.
        const meta = JSON.parse(await fsp.readFile(MANIFEST_FILE));

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
            await pkg.exec([config.updaterScript, '--target', build.updater.target, '--output', updaterOutput]);

            const updaterElapsed = (Date.now() - updaterStart) / 1000;
            log.success('Updater application compiled in *%ds* -> *%s*', updaterElapsed, updaterOutput);
        }

        // Collect checksum data for all files in the build.
        // These are stored in the manifest and used for update checking.
        log.info('Calculating file checksums...');
        const contents = {};
        const files = await collectFiles(buildDir);

        let entryCount = 0;
        let totalSize = 0;

        for (const file of files) {
            const relative = path.relative(buildDir, file).replace(/\\/g, '/');
            const hash = await getFileHash(file, 'sha256', 'hex');
            const stats = await fsp.stat(file);

            contents[relative] = [hash, stats.size];
            totalSize += stats.size;
            entryCount++;
        }

        log.info('Checksum complete (*%s* in *%d* files)', filesize(totalSize), entryCount);

        // Build a manifest (package.json) file for the build.
        const manifest = {};

        // Apply manifest properties inherited from this scripts manifest.
        for (const inherit of config.manifestInherit || [])
            manifest[inherit] = meta[inherit];

        // Apply manifest properties defined in the config.
        Object.assign(manifest, config.manifest);

        // Apply build specific meta data to the manifest.
        Object.assign(manifest, { flavour: build.name, guid: buildGUID, contents });

        const manifestPath = path.resolve(path.join(buildDir, build.manifestTarget));
        await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
        log.success('Manifest file written to *%s*', manifestPath);

        const buildArchiveType = build.buildArchive;
        if (buildArchiveType) {
            if (buildArchiveType === 'ZIP') {
                // ToDo: Use AdmZip to archive the output files.
            } else if (buildArchiveType === 'GZ') {
                // ToDo: Use tar to archive the output files.
            } else {
                throw new Error('Unknown build archive type: ' + buildArchiveType);
            }
        }

        const buildElapsed = (Date.now() - buildStart) / 1000;
        log.success('Build *%s* completed in *%ds*', build.name, buildElapsed);
    }

    const allBuildsElapsed = (Date.now() - allBuildsStart) / 1000;
    log.success('*%d* builds completed in *%ds*!', targetBuilds.length, allBuildsElapsed);
})().catch(e => {
    log.error('An unexpected error has halted the build:');
    log.error(e.stack);
});