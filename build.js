const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const argv = process.argv.splice(2);

const CONFIG_FILE = path.resolve('./build.conf');

const log = {
    error: (msg, ...params) => console.log(chalk.red('ERR ') + msg, ...params),
    warn: (msg, ...params) => console.log(chalk.yellow('WARN ') + msg, ...params),
    success: (msg, ...params) => console.log(chalk.green('DONE ') + msg, ...params),
    info: (msg, ...params) => console.log(chalk.blue('INFO ') + msg, ...params)
};

(async () => {
    const config = JSON.parse(await fs.readFile(CONFIG_FILE));

    // Create the output directory if needed.
    const outDir = path.resolve(config.outputDirectory);
    await fs.mkdir(outDir, { recursive: true });

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
        log.info('Available builds: %s', config.builds.map(e => e.name).join(', '));
        return;
    }

    log.info('Selected builds: %s', targetBuilds.map(e => e.name).join(', '));

    for (const build of targetBuilds) {
        log.info('Compiling build: %s', build.name);

        // ToDo: Wipe the existing directory for the build (controlled by per-build flag).
        // ToDo: Copy over the source files (hard-copy or symlink, controlled by per-build flag).
        // ToDo: Minify/merge sources (controlled by per-build flag).
        // ToDo: Download the required bundle (if not cached) and extract files.
        // ToDo: Copy over any files from cache that are not blacklisted (locales, notification_helper.exe, etc).
    }
})().catch(e => {
    log.error('An unexpected error has halted the build:');
    log.error(e.toString());
});