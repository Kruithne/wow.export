const argv = process.argv.splice(2);
const fsp = require('fs').promises;
const path = require('path');

/**
 * Returns an array of all files recursively collected from a directory.
 * @param {string} dir Directory to recursively search.
 * @param {array} out Array to be populated with results (automatically created).
 */
const collectFiles = async (dir, out = []) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
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
 * Wrapper for fs.Promises.access() to check if a directory exists.
 * Returns a Promise that resolves to true or false.
 * @param {string} dir 
 */
const directoryExists = async (dir) => {
    return new Promise(resolve => {
        fsp.access(dir).then(() => resolve(true)).catch(() => resolve(false));
    });
};

(async () => {
    console.log('Applying updates, please wait!');

    // Ensure we were given a valid PID by whatever spawned us.
    const pid = Number(argv[0]);
    if (isNaN(pid))
        return console.log('No parent process?');

    // Wait for the parent process (PID) to terminate.
    let isRunning = true;
    while (isRunning) {
        try {
            // Sending 0 as a signal does not kill the process, allowing for existence checking.
            // See: http://man7.org/linux/man-pages/man2/kill.2.html
            process.kill(pid, 0);

            // Introduce a small delay between checks.
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            isRunning = false;
        }
    }

    const installDir = path.dirname(path.resolve(process.execPath));
    const updateDir = path.join(installDir, '.update');

    if (await directoryExists(updateDir)) {
        const updateFiles = await collectFiles(updateDir);
        for (const file of updateFiles) {
            const relativePath = path.relative(updateDir, file);
            const writePath = path.join(installDir, relativePath);

            await fsp.copyFile(file, writePath).catch(() => {
                console.log('UNABLE TO WRITE: %s', writePath);
            });
        }
    } else {
        console.log('Unable to locate update files.');
    }

    // ToDo: Launch process once more.
    // ToDo: Terminate ourselves.
})();