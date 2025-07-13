const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const IpcMessageId = {
	HANDSHAKE_REQUEST: 1,
	HANDSHAKE_RESPONSE: 2
};

let main_window;
let cli_process;
let cli_ipc_client;

class CliBinaryIpcClient {
	constructor() {
		this.handlers = {};
		this.buffer = Buffer.alloc(0);
	}
	
	register_handler(message_id, handler) {
		this.handlers[message_id] = handler;
	}
	
	send_handshake_request(platform, electron_version, chrome_version, node_version) {
		console.log('Creating handshake request...');
		
		// Create GUI version string: gui-{app_version}-electron{electron_ver}-node{node_ver}-{platform}
		const package_info = require('./package.json');
		const app_version = package_info.version || '1.0.0';
		const gui_version = `gui-${app_version}-electron${electron_version}-node${node_version}-${platform}`;
		
		console.log('GUI version string:', gui_version);
		console.log('Sending handshake request message ID:', IpcMessageId.HANDSHAKE_REQUEST);
		this.send_string_message(IpcMessageId.HANDSHAKE_REQUEST, gui_version);
	}
	
	send_message(message_id, header_buffer) {
		console.log(`Sending binary message: id=${message_id}, header_size=${header_buffer.length}`);
		
		const id_buffer = Buffer.alloc(4);
		id_buffer.writeUInt32LE(message_id, 0);
		
		console.log('Message ID buffer (hex):', id_buffer.toString('hex'));
		console.log('Header buffer (first 32 bytes):', header_buffer.slice(0, 32).toString('hex'));
		
		cli_process.stdin.write(id_buffer);
		cli_process.stdin.write(header_buffer);
		
		console.log('Message sent to core process');
	}
	
	send_string_message(message_id, message_string) {
		console.log(`Sending string message: id=${message_id}, string="${message_string}"`);
		
		const id_buffer = Buffer.alloc(4);
		id_buffer.writeUInt32LE(message_id, 0);
		
		const string_bytes = Buffer.from(message_string, 'utf8');
		const length_buffer = Buffer.alloc(4);
		length_buffer.writeUInt32LE(string_bytes.length, 0);
		
		console.log('Message ID buffer (hex):', id_buffer.toString('hex'));
		console.log('String length:', string_bytes.length);
		console.log('String bytes (hex):', string_bytes.toString('hex'));
		
		cli_process.stdin.write(id_buffer);
		cli_process.stdin.write(length_buffer);
		cli_process.stdin.write(string_bytes);
		
		console.log('String message sent to core process');
	}
	
	handle_stdout_data(data) {
		console.log('Received data from core:', data.length, 'bytes');
		console.log('Data (hex):', data.toString('hex'));
		
		this.buffer = Buffer.concat([this.buffer, data]);
		console.log('Total buffer size:', this.buffer.length);
		
		while (this.buffer.length >= 4) {
			const message_id = this.buffer.readUInt32LE(0);
			console.log('Parsed message ID:', message_id);
			
			// All handshake messages are now string-based
			if (message_id === IpcMessageId.HANDSHAKE_REQUEST || message_id === IpcMessageId.HANDSHAKE_RESPONSE) {
				// Need at least 8 bytes: 4 for message_id + 4 for string length
				if (this.buffer.length < 8) {
					console.log('Waiting for string length. Have:', this.buffer.length, 'Need: 8');
					break;
				}
				
				const string_length = this.buffer.readUInt32LE(4);
				console.log('String length:', string_length);
				
				const total_needed = 8 + string_length;
				if (this.buffer.length < total_needed) {
					console.log('Waiting for string data. Have:', this.buffer.length, 'Need:', total_needed);
					break;
				}
				
				const string_bytes = this.buffer.slice(8, 8 + string_length);
				const message_string = string_bytes.toString('utf8');
				this.buffer = this.buffer.slice(8 + string_length);
				
				console.log('Dispatching string message ID:', message_id, 'with string:', message_string);
				this.dispatch_string_message(message_id, message_string);
			} else {
				console.error(`Unknown message ID: ${message_id}`);
				console.log('Buffer contents (hex):', this.buffer.slice(0, Math.min(16, this.buffer.length)).toString('hex'));
				this.buffer = this.buffer.slice(4);
			}
		}
	}
	
	dispatch_string_message(message_id, message_string) {
		console.log(`Dispatching string message: id=${message_id}, string="${message_string}"`);
		
		if (this.handlers[message_id]) {
			this.handlers[message_id](message_string);
		} else {
			console.error(`No handler registered for message ID: ${message_id}`);
		}
	}
}

function create_window() {
	main_window = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	main_window.loadFile('index.html');

	if (process.argv.includes('--dev'))
		main_window.webContents.openDevTools();

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
	
	console.log('Spawning core process:', core_path);
	
	if (!fs.existsSync(core_path)) {
		console.error('Core executable not found at:', core_path);
		if (main_window)
			main_window.webContents.send('cli-spawn-error', `Core executable not found at: ${core_path}`);

		return;
	}
	
	cli_process = spawn(core_path, ['--context=ipc'], {
		stdio: ['pipe', 'pipe', 'pipe']
	});
	
	cli_ipc_client = new CliBinaryIpcClient();
	
	console.log('Registering handshake response handler for message ID:', IpcMessageId.HANDSHAKE_RESPONSE);
	cli_ipc_client.register_handler(IpcMessageId.HANDSHAKE_RESPONSE, (core_version) => {
		console.log('HANDSHAKE RESPONSE HANDLER CALLED!');
		console.log('Received handshake response from core:', core_version);
		
		if (main_window) {
			console.log('Sending cli-handshake-complete event to renderer');
			main_window.webContents.send('cli-handshake-complete', {
				version: core_version,
				timestamp: new Date().toISOString()
			});
		} else {
			console.error('main_window is not available');
		}
	});
	
	console.log('Handler registration complete');
	
	cli_process.stdout.on('data', (data) => {
		console.log('Raw stdout data received from core process');
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
		console.log('Timeout reached, attempting to send binary handshake to core');
		console.log('Process versions:', {
			platform: process.platform,
			electron: process.versions.electron,
			chrome: process.versions.chrome,
			node: process.versions.node
		});
		
		if (cli_process && !cli_process.killed) {
			console.log('Core process is alive, sending handshake...');
			cli_ipc_client.send_handshake_request(
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

ipcMain.handle('send-cli-message', (event, message_id, data) => {
	if (cli_ipc_client) {
		cli_ipc_client.send_message(message_id, data);
		return { success: true };
	}
	return { success: false, error: 'Core not connected' };
});