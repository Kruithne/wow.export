const exec = require('child_process').exec;

const PROCESS_NAME = 'wow.export';

// There's no built-in for process handling, so we need to
// use OS-specific commands to check for our parent process.
let processCmd = '';
switch (process.platform) {
    case 'win32': processCmd = 'tasklist'; break;
    case 'darwin': processCmd = 'ps -ax | grep ' + PROCESS_NAME; break;
    case 'linux': processCmd = 'ps -A';
}

/**
 * Check if our main process is currently active.
 */
const checkForProcess = async () => {
    return new Promise((resolve, reject) => {
        exec(processCmd, (err, stdout) => {
            if (err)
                return reject(err);

            resolve(stdout.toLowerCase().includes(PROCESS_NAME));
        });
    });
};

(async () => {
    // Here we wait until the parent process exits.
    // We use a basic promise-wrapped timeout to delay each check.
    let isRunning = true;
    while (isRunning) {
        isRunning = await checkForProcess();
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // ToDo: Clone files from update directory.
    // ToDo: Launch process once more.
    // ToDo: Terminate ourselves.
})();