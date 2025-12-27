/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import zlib from 'node:zlib';
import os from 'node:os';

const fsp = fs.promises;
const inflate_buffer = util.promisify(zlib.inflate);

const PLATFORM = process.platform;

function get_install_path() {
	switch (PLATFORM) {
		case 'win32':
			return path.join(process.env.LOCALAPPDATA, 'wow.export');

		case 'darwin':
			return path.join(os.homedir(), 'Library', 'Application Support', 'wow.export');

		case 'linux':
			return path.join(os.homedir(), '.local', 'share', 'wow.export');

		default:
			throw new Error('Unsupported platform: ' + PLATFORM);
	}
}

function get_executable_name() {
	switch (PLATFORM) {
		case 'win32':
			return 'wow.export.exe';

		case 'darwin':
			return 'wow.export.app/Contents/MacOS/wow.export';

		case 'linux':
			return 'wow.export';
	}
}

function get_icon_path(install_path) {
	switch (PLATFORM) {
		case 'win32':
			return path.join(install_path, 'res', 'icon.png');

		case 'darwin':
			return path.join(install_path, 'wow.export.app', 'Contents', 'Resources', 'app.icns');

		case 'linux':
			return path.join(install_path, 'res', 'icon.png');
	}
}

async function create_desktop_shortcut(install_path) {
	const exec_path = path.join(install_path, get_executable_name());

	switch (PLATFORM) {
		case 'win32':
			await create_windows_shortcut(exec_path);
			break;

		case 'darwin':
			await create_macos_shortcut(install_path);
			break;

		case 'linux':
			await create_linux_shortcut(exec_path, get_icon_path(install_path));
			break;
	}
}

async function create_windows_shortcut(exec_path) {
	const desktop = path.join(os.homedir(), 'Desktop');
	const shortcut_path = path.join(desktop, 'wow.export.lnk');
	const working_dir = path.dirname(exec_path);

	const ps_script = `
		$WshShell = New-Object -ComObject WScript.Shell
		$Shortcut = $WshShell.CreateShortcut("${shortcut_path.replace(/\\/g, '\\\\')}")
		$Shortcut.TargetPath = "${exec_path.replace(/\\/g, '\\\\')}"
		$Shortcut.WorkingDirectory = "${working_dir.replace(/\\/g, '\\\\')}"
		$Shortcut.Description = "Export Toolkit for World of Warcraft"
		$Shortcut.Save()
	`;

	const proc = Bun.spawn(['powershell', '-Command', ps_script]);
	await proc.exited;

	if (proc.exitCode === 0)
		console.log('Created desktop shortcut: %s', shortcut_path);
	else
		console.log('WARN: Failed to create desktop shortcut');
}

async function create_macos_shortcut(install_path) {
	const app_path = path.join(install_path, 'wow.export.app');
	const applications_link = '/Applications/wow.export.app';

	try {
		await fsp.unlink(applications_link);
	} catch {
		// ignore if doesn't exist
	}

	try {
		await fsp.symlink(app_path, applications_link);
		console.log('Created Applications symlink: %s', applications_link);
	} catch (e) {
		console.log('WARN: Failed to create Applications symlink: %s', e.message);
	}
}

async function create_linux_shortcut(exec_path, icon_path) {
	const applications_dir = path.join(os.homedir(), '.local', 'share', 'applications');
	await fsp.mkdir(applications_dir, { recursive: true });

	const desktop_file = path.join(applications_dir, 'wow-export.desktop');
	const content = `[Desktop Entry]
Name=wow.export
Comment=Export Toolkit for World of Warcraft
Exec="${exec_path}"
Icon=${icon_path}
Terminal=false
Type=Application
Categories=Utility;Game;
`;

	await fsp.writeFile(desktop_file, content, 'utf8');
	await fsp.chmod(desktop_file, 0o755);
	console.log('Created desktop entry: %s', desktop_file);
}

async function extract_data_pak(install_path) {
	const installer_dir = path.dirname(path.resolve(process.execPath));
	const manifest_path = path.join(installer_dir, 'data.pak.json');
	const data_path = path.join(installer_dir, 'data.pak');

	console.log('Reading installation manifest...');

	const manifest = JSON.parse(await fsp.readFile(manifest_path, 'utf8'));
	const data = await fsp.readFile(data_path);
	const files = Object.entries(manifest.contents);
	const total = files.length;

	console.log('Extracting %d files...', total);

	let extracted = 0;
	for (const [relative_path, entry] of files) {
		const target_path = path.join(install_path, relative_path);

		await fsp.mkdir(path.dirname(target_path), { recursive: true });

		const compressed = data.subarray(entry.ofs, entry.ofs + entry.compSize);
		const decompressed = await inflate_buffer(compressed);

		await fsp.writeFile(target_path, decompressed);
		extracted++;

		console.log('  [%d/%d] %s', extracted, total, relative_path);
	}

	console.log('Extracted %d files successfully', extracted);

	// set executable permissions on unix platforms
	if (PLATFORM !== 'win32') {
		const exec_path = path.join(install_path, get_executable_name());
		await fsp.chmod(exec_path, 0o755);

		// also chmod the updater
		const updater_name = PLATFORM === 'darwin' ? 'updater' : 'updater';
		const updater_path = path.join(install_path, updater_name);
		try {
			await fsp.chmod(updater_path, 0o755);
		} catch {
			// updater may not exist
		}
	}
}

(async () => {
	try {
		console.log('');
		console.log('                                                  _   ');
		console.log(' __      _______      _______  ___ __   ___  _ __| |_ ');
		console.log(' \\ \\ /\\ / / _ \\ \\ /\\ / / _ \\ \\/ / \'_ \\ / _ \\| \'__| __|');
		console.log('  \\ V  V / (_) \\ V  V /  __/>  <| |_) | (_) | |  | |_ ');
		console.log('   \\_/\\_/ \\___/ \\_/\\_(_)___/_/\\_\\ .__/ \\___/|_|   \\__|');
		console.log('                                |_|                   ');
		console.log('');

		const install_path = get_install_path();
		console.log('Install location: %s', install_path);
		console.log('');

		await fsp.mkdir(install_path, { recursive: true });

		await extract_data_pak(install_path);

		console.log('');
		console.log('Creating shortcuts...');
		await create_desktop_shortcut(install_path);

		console.log('');
		console.log('===========================================');
		console.log('  Installation complete!');
		console.log('===========================================');
		console.log('');
		console.log('You can now launch wow.export from your desktop.');
		console.log('');

		await Bun.sleep(3000);
	} catch (e) {
		console.error('');
		console.error('Installation failed: %s', e.message);
		console.error('');
		console.error('Press any key to exit...');

		// wait for input before closing
		await new Promise(resolve => {
			process.stdin.setRawMode?.(true);
			process.stdin.resume();
			process.stdin.once('data', resolve);
		});

		process.exit(1);
	}
})();
