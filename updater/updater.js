const argv = process.argv.splice(2);

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

    // ToDo: Clone files from update directory.
    // ToDo: Launch process once more.
    // ToDo: Terminate ourselves.
})();