const fs = require('fs');
const path = require('path');
const util = require('util');
const log = require('./log');
const core = require('./core');
const config = require('./config');
const constants = require('./constants');
const generics = require('./generics');
const listfile = require('./casc/listfile');

// Command implementations
const textureExporter = require('./ui/texture-exporter');
const modelViewerUtils = require('./ui/model-viewer-utils');
const dataExporter = require('./ui/data-exporter');
const cascRemote = require('./casc/casc-source-remote');
const cascLocal = require('./casc/casc-source-local');
const ExportHelper = require('./casc/export-helper');
const WDCReader = require('./db/WDCReader');
const dbd_manifest = require('./casc/dbd-manifest');

const CLI = {
    args: {},
    commands: {}
};

const cliLogFile = path.join(process.cwd(), 'wow-export-cli.log');

/**
 * Output a message to the console AND to a log file for debugging.
 */
const print = (msg, ...params) => {
    const output = params.length > 0 ? util.format(msg, ...params) : msg;
    const isError = msg.startsWith('[ERROR]');
    
    // Attempt to write to stdout/stderr (may be hidden in GUI process)
    try {
        (isError ? process.stderr : process.stdout).write(output + '\n');
    } catch (e) {}

    // ALWAYS write to the local log file
    try {
        fs.appendFileSync(cliLogFile, `[${new Date().toISOString()}] ${output}\n`);
    } catch (e) {
        // Ignore
    }
};

/**
 * Initialize the CLI environment.
 */
CLI.init = async () => {
    // Clear log file and add a "Started" marker
    try { 
        fs.writeFileSync(cliLogFile, '--- WOW.EXPORT CLI STARTED ---\n'); 
    } catch (e) {
        // If we can't write here, we might be in a read-only dir
    }

    print('[CLI] Initializing...');

    // 1. Mock Logging to Console
    log.write = (...params) => {
        print('[LOG] ' + util.format(...params));
    };

    // 2. Mock Core View & UI functions
    core.view = core.makeNewView();
    
    core.view.$watch = (exp, cb, options) => {
        if (options && options.immediate) {
            const parts = exp.split('.');
            if (parts.length === 2 && parts[0] === 'config') {
                 cb(core.view.config[parts[1]]);
            }
        }
    };

    core.setToast = (type, message) => {
        print(`[${type.toUpperCase()}] ${message}`);
    };

    core.showLoadingScreen = (segments, title) => {
        print(`[LOADING] ${title || 'Please wait...'}`);
    };

    core.progressLoadingScreen = async (text) => {
        if (text) print(`[PROGRESS] ${text}`);
    };

    core.hideLoadingScreen = () => {
        print('[LOADING] Complete.');
    };
    
    core.openLastExportStream = () => {
        return {
            writeLine: (line) => print('[EXPORTED] ' + line),
            close: () => {}
        };
    };

    generics.redraw = async () => {
        return Promise.resolve();
    };

    // 3. Load Configuration
    print('[CLI] Loading configuration...');
    await config.load();

    // 4. Parse Arguments
    CLI.parseArgs();

    // 5. Override Config from Args
    if (CLI.args.out) {
        core.view.config.exportDirectory = path.resolve(CLI.args.out);
        print(`[CONFIG] Export directory set to: ${core.view.config.exportDirectory}`);
    }

    if (CLI.args.listfile) {
        core.view.config.listfileURL = path.resolve(CLI.args.listfile);
        core.view.config.enableBinaryListfile = false;
        print(`[CONFIG] Using local listfile: ${core.view.config.listfileURL}`);
    }

    if (CLI.args['include-links']) {
        core.view.config.modelsExportTextures = true;
        core.view.config.modelsExportSkin = true;
        core.view.config.modelsExportSkel = true;
        core.view.config.modelsExportBone = true;
        core.view.config.modelsExportAnim = true;
        core.view.config.modelsExportWMOGroups = true;
        print('[CONFIG] Linked files extraction enabled (textures, animations, etc.)');
    }

    // Default CLI overrides to ensure named exports
    core.view.config.exportNamedFiles = true;
    core.view.config.exportFullPaths = true;
    
    if (!core.view.config.cascLocale) {
        core.view.config.cascLocale = 0x2; // Default to enUS
    }

    if (CLI.args.format) {
        const format = CLI.args.format.toUpperCase();
        core.view.config.exportTextureFormat = format;
        core.view.config.exportModelFormat = format;
    } else if (!core.view.config.exportTextureFormat) {
        core.view.config.exportTextureFormat = 'PNG';
    }

    // 6. Execute Command
    const command = CLI.args.command;
    if (CLI.commands[command]) {
        try {
            print(`[CLI] Executing command: ${command}`);
            await CLI.commands[command]();
        } catch (e) {
            print(`[ERROR] Command failed: ${e.message}`);
            print(e.stack);
            process.exit(1);
        }
    } else {
        if (command) {
            print(`[ERROR] Unknown command: ${command}`);
        } else {
            print('[ERROR] No command specified.');
        }
        print('Available commands: %s', Object.keys(CLI.commands).join(', '));
        process.exit(1);
    }
};

/**
 * Parse command line arguments from nw.App.argv
 */
CLI.parseArgs = () => {
    const rawArgs = nw.App.argv;
    print('[CLI] Raw Arguments: %o', rawArgs);

    const args = { };
    
    if (rawArgs.length > 0 && !rawArgs[0].startsWith('--')) {
        args.command = rawArgs[0];
    }

    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg.startsWith('--')) {
            const key = arg.substring(2);
            let values = [];
            while (rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--')) {
                values.push(rawArgs[i + 1]);
                i++;
            }
            
            if (values.length === 0) {
                args[key] = true;
            } else if (values.length === 1) {
                args[key] = values[0];
            } else {
                // Join multiple values with a comma so they can be parsed as a list later.
                args[key] = values.join(',');
            }
        }
    }
    CLI.args = args;
    print('[CLI] Arguments parsed: %o', CLI.args);
};

/**
 * Helper to get a list of values from a potentially comma-separated argument string.
 */
CLI.getArgList = (input) => {
    if (!input) return [];
    if (typeof input !== 'string') return [input];
    return input.split(',').map(e => e.replace(/,$/, '').trim()).filter(e => e.length > 0);
};

/**
 * Initialize CASC source.
 */
CLI.initCASC = async () => {
    let casc;
    const localPath = CLI.args.local || core.view.config.lastSelectedRoot;

    if (CLI.args.region || CLI.args.build || !localPath) {
        const region = CLI.args.region || 'us';
        print(`[CASC] Initializing remote CASC (${region})...`);
        casc = new cascRemote(region);
        await casc.init();

        const builds = casc.getProductList();
        let buildIndex = 0; 
        if (CLI.args.build) {
            buildIndex = builds.findIndex(b => b.label.toLowerCase().includes(CLI.args.build.toLowerCase()));
            if (buildIndex === -1) {
                print(`[ERROR] Build containing '${CLI.args.build}' not found.`);
                print('Available builds:\n%s', builds.map(b => b.label).join('\n'));
                process.exit(1);
            }
        }
        print(`[CASC] Selected build: ${builds[buildIndex].label}`);
        await casc.load(buildIndex);
    } else {
        print(`[CASC] Initializing local CASC (${localPath})...`);
        casc = new cascLocal(localPath);
        try {
            await casc.init();
        } catch (e) {
            print(`[ERROR] Failed to initialize local CASC: ${e.message}`);
            print('[HINT] Make sure the path points to your WoW installation (e.g. "C:\\Games\\World of Warcraft\\_retail_")');
            process.exit(1);
        }

        const builds = casc.getProductList();
        if (builds.length === 0) {
            print('[ERROR] No valid World of Warcraft builds found in the specified local path.');
            process.exit(1);
        }

        print(`[CASC] Found ${builds.length} local builds:`);
        builds.forEach((b, i) => print(`  [${i}] ${b.label} (${casc.builds[i].Product})`));

        let buildIndex = -1;
        if (CLI.args.build) {
            buildIndex = builds.findIndex(b => b.label.toLowerCase().includes(CLI.args.build.toLowerCase()));
            if (buildIndex === -1) {
                print(`[ERROR] Build containing '${CLI.args.build}' not found in local installation.`);
                process.exit(1);
            }
        } else {
            // Prefer Retail ('wow' product) if no build specified.
            buildIndex = casc.builds.findIndex(b => b.Product === 'wow');
            if (buildIndex === -1) buildIndex = 0;
            print(`[CASC] No build specified, defaulting to: ${builds[buildIndex].label}`);
        }

        print(`[CASC] Loading build: ${builds[buildIndex].label}...`);
        await casc.load(buildIndex);
    }

    core.view.casc = casc;
    print(`[CASC] Root loaded with ${casc.rootEntries.size} entries.`);

    // Check if listfile is loaded.
    if (!listfile.isLoaded()) {
        print('[CASC] Listfile not yet loaded, initializing...');
        await listfile.prepareListfile();
    }

    print('[CASC] Matching listfile against root entries...');
    listfile.applyPreload(casc.rootEntries);

    if (listfile.isLoaded()) {
        const testID = 123061;
        const testName = listfile.getByID(testID);
        print(`[CASC] Listfile ready. Test resolution for ID ${testID}: ${testName || 'FAILED'}`);
    } else {
        print('[ERROR] Listfile failed to load. This usually happens if the internet is blocked.');
        print('[HINT] You can provide a local listfile using: --listfile "C:\\path\\to\\listfile.csv"');
        print('[HINT] You can download one from: https://github.com/wowdev/wow-listfile/releases');
    }
    
    print('[CASC] Ready.');
};

// --- Commands ---

CLI.commands['list-files'] = async () => {
    await CLI.initCASC();
    const search = CLI.args.search;
    if (!search) {
        print('[ERROR] Please specify --search <term> or <fileDataID>');
        process.exit(1);
    }

    print(`[SEARCH] Searching for: ${search}...`);
    
    const results = [];
    const searchID = parseInt(search);
    if (!isNaN(searchID)) {
        const name = listfile.getByID(searchID);
        const inRoot = core.view.casc.rootEntries.has(searchID);
        print(`[RESULT] ID: ${searchID}`);
        print(`[RESULT] In CASC Root: ${inRoot ? 'YES' : 'NO'}`);
        print(`[RESULT] Listfile Name: ${name || 'UNKNOWN'}`);
        
        if (inRoot && !name) {
            print('[DEBUG] ID is in game files but listfile doesn\'t have a name for it.');
        }
    }

    const filtered = listfile.getFilteredEntries(search);
    if (filtered.length > 0) {
        print(`[SEARCH] Found ${filtered.length} matches:`);
        filtered.slice(0, 50).forEach(r => print(`  [${r.fileDataID}] ${r.fileName}`));
        if (filtered.length > 50) print(`  ... and ${results.length - 50} more.`);
    } else if (isNaN(searchID)) {
        print('[SEARCH] No matches found for string search.');
    }
    process.exit(0);
};

CLI.commands['list-builds'] = async () => {
    let casc;
    const localPath = CLI.args.local || core.view.config.lastSelectedRoot;

    if (CLI.args.region || !localPath) {
        const region = CLI.args.region || 'us';
        print(`[CASC] Fetching remote builds for ${region}...`);
        casc = new cascRemote(region);
        await casc.init();
    } else {
        print(`[CASC] Fetching local builds for ${localPath}...`);
        casc = new cascLocal(localPath);
        await casc.init();
    }
    
    const builds = casc.getProductList();
    print('\nAvailable Builds:');
    builds.forEach((b, i) => {
        print(`[${i}] ${b.label} (${casc.builds[i].Product})`);
    });
    process.exit(0);
};

CLI.commands['export-texture'] = async () => {
    await CLI.initCASC();
    
    if (!CLI.args.id && !CLI.args.name) {
        print('[ERROR] Please specify --id <fileDataID> or --name <fileName>');
        process.exit(1);
    }

    const exportList = [];
    CLI.getArgList(CLI.args.id).forEach(id => exportList.push(parseInt(id)));
    CLI.getArgList(CLI.args.name).forEach(name => exportList.push(name));

    print(`[EXPORT] Exporting ${exportList.length} textures...`);
    
    for (const entry of exportList) {
        if (typeof entry === 'number') {
            const name = listfile.getByID(entry);
            print(`[EXPORT] Processing ID ${entry}${name ? ' (' + name + ')' : ''}...`);
        } else {
            print(`[EXPORT] Processing ${entry}...`);
        }
    }

    await textureExporter.exportFiles(exportList, false);
    print('[EXPORT] Done.');
    process.exit(0);
};

CLI.commands['export-model'] = async () => {
    await CLI.initCASC();

    if (!CLI.args.id && !CLI.args.name) {
        print('[ERROR] Please specify --id <fileDataID> or --name <fileName>');
        process.exit(1);
    }

    const exportList = [];
    CLI.getArgList(CLI.args.id).forEach(id => exportList.push(parseInt(id)));
    CLI.getArgList(CLI.args.name).forEach(name => exportList.push(name));

    print(`[EXPORT] Exporting ${exportList.length} models...`);
    
    const helper = new ExportHelper(exportList.length, 'model');
    helper.start();
    
    const export_paths = core.openLastExportStream();

    for (const file_entry of exportList) {
        let file_name;
        let file_data_id;

        if (typeof file_entry === 'number') {
            file_data_id = file_entry;
            file_name = listfile.getByID(file_data_id);
        } else {
            file_name = listfile.stripFileEntry(file_entry);
            file_data_id = listfile.getByFilename(file_name);
        }
        
        if (!file_data_id) {
             print(`[ERROR] Could not resolve file: ${file_entry}`);
             continue;
        }

        print(`[EXPORT] Processing ${file_name || file_data_id}...`);

        try {
            const data = await core.view.casc.getFile(file_data_id);
            await modelViewerUtils.export_model({
                core,
                data,
                file_data_id,
                file_name: file_name || `unknown/${file_data_id}.m2`,
                format: core.view.config.exportModelFormat,
                export_path: ExportHelper.getExportPath(file_name || `unknown/${file_data_id}.m2`),
                helper,
                file_manifest: [],
                export_paths
            });
        } catch (e) {
            print(`[ERROR] Failed to export ${file_name || file_data_id}: ${e.message}`);
        }
    }
    
    helper.finish();
    print('[EXPORT] Done.');
    process.exit(0);
};

CLI.commands['export-file'] = async () => {
    await CLI.initCASC();

    if (!CLI.args.id && !CLI.args.name) {
        print('[ERROR] Please specify --id <fileDataID> or --name <fileName>');
        process.exit(1);
    }

    const exportList = [];
    CLI.getArgList(CLI.args.id).forEach(id => exportList.push(parseInt(id)));
    CLI.getArgList(CLI.args.name).forEach(name => exportList.push(name));

    print(`[EXPORT] Exporting ${exportList.length} files...`);

    const helper = new ExportHelper(exportList.length, 'files');
    helper.start();

    for (const file_entry of exportList) {
        let file_name;
        let file_data_id;

        if (typeof file_entry === 'number') {
            file_data_id = file_entry;
            file_name = listfile.getByID(file_data_id) || `unknown/${file_data_id}.bin`;
        } else {
            file_name = listfile.stripFileEntry(file_entry);
            file_data_id = listfile.getByFilename(file_name);
        }

        print(`[EXPORT] Processing ${file_name} (${file_data_id})...`);

        try {
            const data = await core.view.casc.getFile(file_data_id);
            const export_path = ExportHelper.getExportPath(file_name);
            
            await data.writeToFile(export_path);
            helper.mark(file_name, true);
            print(`[EXPORT] Saved to: ${export_path}`);
        } catch (e) {
            print(`[ERROR] Failed to export ${file_name}: ${e.message}`);
            helper.mark(file_name, false, e.message);
        }
    }

    helper.finish();
    print('[EXPORT] Done.');
    process.exit(0);
};

CLI.commands['export-data'] = async () => {
    await CLI.initCASC();

    if (!CLI.args.table) {
        print('[ERROR] Please specify --table <tableName>');
        process.exit(1);
    }

    const tableName = CLI.args.table;
    const format = (CLI.args.format || 'CSV').toUpperCase();

    print(`[EXPORT] Exporting table ${tableName} as ${format}...`);

    try {
        const db2_reader = new WDCReader('DBFilesClient/' + tableName + '.db2');
        await db2_reader.parse();

        const headers = [...db2_reader.schema.keys()];
        const rows = await db2_reader.getAllRows();
        const parsedRows = Array.from(rows.values()).map(row => Object.values(row));

        if (format === 'CSV') {
            await dataExporter.exportDataTable(headers, parsedRows, tableName);
        } else if (format === 'SQL') {
            const create_table = core.view.config.dataSQLCreateTable;
            await dataExporter.exportDataTableSQL(headers, parsedRows, tableName, db2_reader.schema, create_table);
        } else if (format === 'DB2') {
            const file_data_id = dbd_manifest.getByTableName(tableName);
            if (!file_data_id) throw new Error('Could not find FileDataID for table: ' + tableName);
            await dataExporter.exportRawDB2(tableName, file_data_id);
        } else {
            throw new Error('Unsupported data format: ' + format);
        }

        print('[EXPORT] Done.');
    } catch (e) {
        print(`[ERROR] Failed to export table ${tableName}: ${e.message}`);
    }
    process.exit(0);
};

module.exports = CLI;
