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

const cliLogFile = path.join(constants.DATA_PATH, 'cli.log');

/**
 * Output a message to the console AND to a log file for debugging.
 */
const print = (msg, ...params) => {
    const output = params.length > 0 ? util.format(msg, ...params) : msg;
    const isError = msg.startsWith('[ERROR]');
    (isError ? process.stderr : process.stdout).write(output + '\n');
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
    // Clear log file
    try { fs.writeFileSync(cliLogFile, ''); } catch (e) {}

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
            const next = rawArgs[i + 1];
            if (next && !next.startsWith('--')) {
                args[key] = next;
                i++;
            } else {
                args[key] = true;
            }
        }
    }
    CLI.args = args;
    print('[CLI] Arguments parsed: %o', CLI.args);
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

        // Select build
        let buildIndex = 0; 
        if (CLI.args.build) {
            const builds = casc.getProductList();
            buildIndex = builds.findIndex(b => b.label.toLowerCase().includes(CLI.args.build.toLowerCase()));
            if (buildIndex === -1) {
                print(`[ERROR] Build containing '${CLI.args.build}' not found.`);
                print('Available builds:\n%s', builds.map(b => b.label).join('\n'));
                process.exit(1);
            }
            print(`[CASC] Selected build: ${builds[buildIndex].label}`);
        } else {
            const productList = casc.getProductList();
            if (productList.length === 0) {
                print('[ERROR] No products found on CDN.');
                process.exit(1);
            }
            print(`[CASC] Using latest build: ${productList[0].label}`);
        }
        await casc.load(buildIndex);
    } else {
        print(`[CASC] Initializing local CASC (${localPath})...`);
        casc = new cascLocal(localPath);
        await casc.init();

        let buildIndex = 0;
        if (CLI.args.build) {
            const builds = casc.getProductList();
            buildIndex = builds.findIndex(b => b.label.toLowerCase().includes(CLI.args.build.toLowerCase()));
            if (buildIndex === -1) {
                print(`[ERROR] Build containing '${CLI.args.build}' not found in local installation.`);
                process.exit(1);
            }
        }
        await casc.load(buildIndex);
    }

    core.view.casc = casc;
    print('[CASC] Loading listfile...');
    await listfile.prepareListfile();
    print('[CASC] Ready.');
};

// --- Commands ---

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
        print(`[${i}] ${b.label}`);
    });
    process.exit(0);
};

CLI.commands['export-texture'] = async () => {
    await CLI.initCASC();
    
    if (!CLI.args.id && !CLI.args.name) {
        print('[ERROR] Please specify --id <fileDataID> or --name <fileName>');
        process.exit(1);
    }

    if (CLI.args.format) {
        core.view.config.exportTextureFormat = CLI.args.format.toUpperCase();
    }

    const exportList = [];
    if (CLI.args.id) exportList.push(parseInt(CLI.args.id));
    if (CLI.args.name) exportList.push(CLI.args.name);

    print(`[EXPORT] Exporting ${exportList.length} textures...`);
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

    if (CLI.args.format) {
        core.view.config.exportModelFormat = CLI.args.format.toUpperCase();
    }
    
    const exportList = [];
    if (CLI.args.id) exportList.push(parseInt(CLI.args.id));
    if (CLI.args.name) exportList.push(CLI.args.name);

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

        print(`[EXPORT] Processing ${file_name} (${file_data_id})...`);

        try {
            const data = await core.view.casc.getFile(file_data_id);
            await modelViewerUtils.export_model({
                core,
                data,
                file_data_id,
                file_name,
                format: core.view.config.exportModelFormat,
                export_path: ExportHelper.getExportPath(file_name),
                helper,
                file_manifest: [],
                export_paths
            });
        } catch (e) {
            print(`[ERROR] Failed to export ${file_name}: ${e.message}`);
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
    if (CLI.args.id) exportList.push(parseInt(CLI.args.id));
    if (CLI.args.name) exportList.push(CLI.args.name);

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
