const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ProtobufIpcClient } = require('./src/protobuf_ipc');
const { is_debug_mode } = require('./src/debug_utils');

let main_window;
let cli_process;
let cli_ipc_client;

function create_window() {
	const is_production = app.isPackaged;
	
	main_window = new BrowserWindow({
		width: 1200,
		height: 800,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
			devTools: !is_production
		}
	});

	main_window.loadFile('index.html');

	if (process.argv.includes('--dev'))
		main_window.webContents.openDevTools();

	if (is_production) {
		main_window.webContents.on('context-menu', (event) => {
			event.preventDefault();
		});
	}

	main_window.on('closed', () => {
		main_window = null;
	});
}

app.whenReady().then(() => {
	create_window();
	spawn_cli_process();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0)
			create_window();
	});
});

app.on('window-all-closed', () => {
	if (cli_process)
		cli_process.kill();

	if (process.platform !== 'darwin')
		app.quit();
});

ipcMain.handle('get-app-version', () => {
	return app.getVersion();
});



function spawn_cli_process() {
	let core_path;
	
	if (process.platform === 'win32') {
		core_path = 'wow_export_core.exe';
	} else {
		core_path = 'wow_export_core';
	}
	
	if (!fs.existsSync(core_path)) {
		console.error('Core executable not found at:', core_path);
		if (main_window)
			main_window.webContents.send('cli-spawn-error', `Core executable not found at: ${core_path}`);

		return;
	}
	
	cli_process = spawn(core_path, ['--context=ipc'], {
		stdio: ['pipe', 'pipe', 'pipe']
	});
	
	console.log('Core process spawned with PID:', cli_process.pid);
	
	cli_ipc_client = new ProtobufIpcClient();
	
	cli_ipc_client.register_handler('handshake_response', (response) => {
		if (main_window) {
			main_window.webContents.send('cli-handshake-complete', {
				version: response.core_version,
				timestamp: new Date().toISOString()
			});
			
			if (is_debug_mode()) {
				main_window.webContents.send('update-status-message', 'Debug mode - skipping update check');
				cli_ipc_client.send_region_list_request(cli_process);
			} else {
				main_window.webContents.send('update-status-message', 'Checking for updates...');
				cli_ipc_client.send_update_application_request(cli_process);
			}
		} else {
			console.error('main_window is not available');
		}
	});
	
	cli_ipc_client.register_handler('update_application_response', (response) => {
		if (main_window) {
			main_window.webContents.send('update-status-message', 'Application is up to date');
			cli_ipc_client.send_region_list_request(cli_process);
		} else {
			console.error('main_window is not available');
		}
	});
	
	let total_files_to_update = 0;
	
	cli_ipc_client.register_handler('update_application_stats', (stats) => {
		total_files_to_update = stats.total_files;
		if (main_window) {
			main_window.webContents.send('update-status-message', `Updating ${stats.total_files} files`);
		} else {
			console.log(`Updating ${stats.total_files} files`);
		}
	});
	
	cli_ipc_client.register_handler('update_application_progress', (progress) => {
		if (main_window) {
			main_window.webContents.send('update-status-message', `Downloading ${progress.file_name} ${progress.file_number}/${total_files_to_update}`);
		} else {
			console.log(`Downloading ${progress.file_name} ${progress.file_number}/${total_files_to_update}`);
		}
	});
	
	cli_process.stdout.on('data', (data) => {
		cli_ipc_client.handle_stdout_data(data);
	});
	
	cli_process.stderr.on('data', (data) => {
		console.error('Core stderr:', data.toString());
	});
	
	cli_process.on('close', (code) => {
		console.log(`Core process exited with code ${code}`);
		if (main_window) {
			main_window.webContents.send('cli-spawn-error', `Core process exited with code ${code}`);
		}
	});
	
	cli_process.on('error', (error) => {
		console.error('Core process error:', error);
		if (main_window) {
			main_window.webContents.send('cli-spawn-error', `Core process error: ${error.message}`);
		}
	});
	
	setTimeout(() => {
		if (cli_process && !cli_process.killed) {
			cli_ipc_client.send_handshake_request(
				cli_process,
				process.platform,
				process.versions.electron,
				process.versions.chrome,
				process.versions.node
			);
		} else {
			console.error('Core process is not available for handshake');
		}
	}, 1000);
}

ipcMain.handle('send-cli-message', (event, message_data) => {
	if (cli_ipc_client) {
		cli_ipc_client.send_message(cli_process, message_data);
		return { success: true };
	}
	return { success: false, error: 'Core not connected' };
});