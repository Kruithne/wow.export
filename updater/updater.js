/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const argv = process.argv.splice(2);
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cp = require('child_process');
const util = require('util');

const logOutput = [];

/**
 * Defines the maximum amount of retries to update a file.
 * @type {number}
 */
const MAX_LOCK_TRIES = 30;

/**
 * Return a HH:MM:SS formatted timestamp.
 */
const getTimestamp = () => {
	const time = new Date();
	return util.format(
		'%s:%s:%s',
		time.getHours().toString().padStart(2, '0'),
		time.getMinutes().toString().padStart(2, '0'),
		time.getSeconds().toString().padStart(2, '0'));
};

/**
 * Write a message to the log file which will be written upon exit.
 * @param {string} message 
 * @param  {...any} params 
 */
const log = (message, ...params) => {
	const out = '[' + getTimestamp() + '] ' + util.format(message, ...params);
	logOutput.push(out);
	console.log(out);
};

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
* Recursively delete a directory.
* @param {string} dir Path to the directory.
*/
const deleteDirectory = (dir) => {
	if (fs.existsSync(dir)) {
		let entries = fs.readdirSync(dir);

		for (let entry of entries) {
			let entryPath = path.join(dir, entry);
			let entryStat = fs.lstatSync(entryPath);

			// Recursively delete as a directory or unlink the file/symlink.
			if (entryStat.isFile() || entryStat.isSymbolicLink())
				fs.unlinkSync(entryPath);
			else
				deleteDirectory(entryPath);
		}

		fs.rmdirSync(dir);
	}
}

/**
 * Returns true if the provided file/directory exists.
 * @param {string} file 
 * @returns {boolean}
 */
const fileExists = async (file) => {
	try {
		await fsp.access(file, fs.constants.F_OK);
		return true;
	} catch (e) {
		return false;
	}
};

/**
 * Returns true if the provided file is locked.
 * @param {string} file 
 * @returns {boolean}
 */
const isFileLocked = async (file) => {
	try {
		await fsp.access(file, fs.constants.W_OK);
		return false;
	} catch (e) {
		return true;
	}
};

/**
 * Async function that resolves after the provided amount of milliseconds.
 * @param {number} ms 
 */
const delay = async (ms) => {
	await new Promise(resolve => setTimeout(resolve, ms));
};

(async () => {
	log('Updater has started.');

	// Ensure we were given a valid PID by whatever spawned us.
	const pid = Number(argv[0]);
	if (!isNaN(pid)) {
		// Wait for the parent process (PID) to terminate.
		let isRunning = true;

		log('Waiting for parent process %d to terminate...', pid);
		while (isRunning) {
			try {
				// Sending 0 as a signal does not kill the process, allowing for existence checking.
				// See: http://man7.org/linux/man-pages/man2/kill.2.html
				process.kill(pid, 0);

				// Introduce a small delay between checks.
				await delay(500);
			} catch (e) {
				log('Parent process %d has terminated.', pid);
				isRunning = false;
			}
		}
	} else {
		log('WARN: No parent PID was given to the updater.');
	}

	// We can never be 100% sure that the entire process tree terminated.
	// To that end, send an OS specific termination command.

	// [GH-1] Expand this with support for further platforms as needed.
	let command;
	switch (process.platform) {
		case 'win32':
			command = 'taskkill /f /im wow.export.exe';
	}

	log('Sending auxiliary termination command (%s) %s', process.platform, command);
	await new Promise(resolve => cp.exec(command, resolve));

	const installDir = path.dirname(path.resolve(process.execPath));
	const updateDir = path.join(installDir, '.update');

	log('Install directory: %s', installDir);
	log('Update directory: %s', updateDir);

	if (await fileExists(updateDir)) {
		const updateFiles = await collectFiles(updateDir);
		for (const file of updateFiles) {
			const relativePath = path.relative(updateDir, file);
			const writePath = path.join(installDir, relativePath);

			log('Applying update file %s', writePath);

			try {
				let locked = (await fileExists(writePath)) && (await isFileLocked(writePath));
				let tries = 0;

				while (locked) {
					tries++;

					if (tries >= MAX_LOCK_TRIES)
						throw new Error('File was locked, MAX_LOCK_TRIES exceeded.');

					await delay(1000);
					locked = await isFileLocked(writePath);
				}

				await fsp.mkdir(path.dirname(writePath), { recursive: true });
				await fsp.copyFile(file, writePath).catch(err => {
					log('WARN: Failed to write update file due to system error: %s', err.message);
				});
			} catch (e) {
				log('WARN: ' + e.message);
			}
		}
	} else {
		log('WARN: Update directory does not exist. No update to apply.');
	}
	
	// [GH-1] Expand this with support for further platforms as needed.
	let binary;
	switch (process.platform) {
		case 'win32': binary = 'wow.export.exe'; break;
	}

	log('Re-launching main process %s (%s)', binary, process.platform);

	// Re-launch application.
	if (binary) {
		const child = cp.spawn(path.join(installDir, binary), [], { detached: true, stdio: 'ignore' });
		child.unref();
	}

	// Clear the update directory.
	log('Removing update files...');
	deleteDirectory(updateDir);

	// Write log to disk.
	const logName = util.format('%s-update.log', Date.now());
	const logPath = path.resolve('./logs');

	await fsp.mkdir(logPath, { recursive: true });
	await fsp.writeFile(path.join(logPath, logName), logOutput.join('\n'), 'utf8');

	// Exit updater.
	process.exit();
})();