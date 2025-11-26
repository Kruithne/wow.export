/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const argv = process.argv.splice(2);
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
const fsp = fs.promises;

const log_output = [];

/**
 * Defines the maximum amount of retries to update a file.
 * @type {number}
 */
const MAX_LOCK_TRIES = 30;

function get_timestamp() {
	const time = new Date();
	
	return util.format(
		'%s:%s:%s',
		time.getHours().toString().padStart(2, '0'),
		time.getMinutes().toString().padStart(2, '0'),
		time.getSeconds().toString().padStart(2, '0'));
}

function log (message, ...params) {
	const out = '[' + get_timestamp() + '] ' + util.format(message, ...params);
	log_output.push(out);
	console.log(out);
}

async function collect_files(dir, out = []) {
	const entries = await fsp.readdir(dir, { withFileTypes: true });
	for await (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory())
			await collect_files(entryPath, out);
		else
			out.push(entryPath);
	}

	return out;
}

function delete_directory(dir) {
	if (fs.existsSync(dir)) {
		let entries = fs.readdirSync(dir);

		for (let entry of entries) {
			let entryPath = path.join(dir, entry);
			let entryStat = fs.lstatSync(entryPath);

			// Recursively delete as a directory or unlink the file/symlink.
			if (entryStat.isFile() || entryStat.isSymbolicLink())
				fs.unlinkSync(entryPath);
			else
				delete_directory(entryPath);
		}

		fs.rmdirSync(dir);
	}
}

async function file_exists(file) {
	try {
		await fsp.access(file, fs.constants.F_OK);
		return true;
	} catch (e) {
		return false;
	}
}

async function is_file_locked(file) {
	try {
		await fsp.access(file, fs.constants.W_OK);
		return false;
	} catch (e) {
		return true;
	}
}

(async () => {
	try {
		log('Updater has started.');
	
		// Ensure we were given a valid PID by whatever spawned us.
		const pid = Number(argv[0]);
		if (!isNaN(pid)) {
			// Wait for the parent process (PID) to terminate.
			let is_running = true;
	
			log('Waiting for parent process %d to terminate...', pid);
			while (is_running) {
				try {
					// Sending 0 as a signal does not kill the process, allowing for existence checking.
					// See: http://man7.org/linux/man-pages/man2/kill.2.html
					process.kill(pid, 0);
	
					// Introduce a small delay between checks.
					await Bun.sleep(500);
				} catch (e) {
					log('Parent process %d has terminated.', pid);
					is_running = false;
				}
			}
		} else {
			log('WARN: No parent PID was given to the updater.');
		}
	
		// We can never be 100% sure that the entire process tree terminated.
		// To that end, send an OS specific termination command.
		let command = [];
		switch (process.platform) {
			case 'win32':
				command = ['taskkill', '/f', '/im', 'wow.export.exe'];
				break;
			default: // linux, darwin
				command = ['pkill', '-f', 'wow.export'];
				break;
		}
	
		log('Sending auxiliary termination command (%s) %s', process.platform, command);
		const proc = Bun.spawn(command);
		await proc.exited;
	
		const install_dir = path.dirname(path.resolve(process.execPath));
		const update_dir = path.join(install_dir, '.update');
	
		log('Install directory: %s', install_dir);
		log('Update directory: %s', update_dir);
	
		if (await file_exists(update_dir)) {
			const update_files = await collect_files(update_dir);
			for (const file of update_files) {
				const relative_path = path.relative(update_dir, file);
				const write_path = path.join(install_dir, relative_path);
	
				log('Applying update file %s', write_path);
	
				try {
					let locked = (await file_exists(write_path)) && (await is_file_locked(write_path));
					let tries = 0;
	
					while (locked) {
						tries++;
	
						if (tries >= MAX_LOCK_TRIES)
							throw new Error('File was locked, MAX_LOCK_TRIES exceeded.');
	
						await Bun.sleep(1000);
						locked = await is_file_locked(write_path);
					}
	
					await fsp.mkdir(path.dirname(write_path), { recursive: true });
					await fsp.copyFile(file, write_path).catch(err => {
						log('WARN: Failed to write update file due to system error: %s', err.message);
					});
				} catch (e) {
					log('WARN: ' + e.message);
				}
			}
		} else {
			log('WARN: Update directory does not exist. No update to apply.');
		}
		
		const binary = process.platform === 'win32' ? 'wow.export.exe' : 'wow.export';
		log('Re-launching main process %s (%s)', binary, process.platform);
		if (binary) {
			const child = Bun.spawn([path.join(install_dir, binary)], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore']
			});
			child.unref();
			log('wow.export has been updated, have fun!');
			await Bun.sleep(5000);
		}

		log('Removing update files...');
		delete_directory(update_dir);
	} catch (e) {
		console.error(e);
		log(e.message);
	} finally {
		const log_name = util.format('%s-update.log', Date.now());
		const log_path = path.resolve('./logs');
	
		await fsp.mkdir(log_path, { recursive: true });
		await fsp.writeFile(path.join(log_path, log_name), log_output.join('\n'), 'utf8');
	
		process.exit();
	}
})();