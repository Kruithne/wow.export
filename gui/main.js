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
		console.log('Creating handshake request header...');
		const header = this.create_handshake_request_header(platform, electron_version, chrome_version, node_version);
		console.log('Handshake header created, size:', header.length);
		console.log('Sending handshake request message ID:', IpcMessageId.HANDSHAKE_REQUEST);
		this.send_message(IpcMessageId.HANDSHAKE_REQUEST, header);
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
	
	handle_stdout_data(data) {
		console.log('Received data from core:', data.length, 'bytes');
		console.log('Data (hex):', data.toString('hex'));
		
		this.buffer = Buffer.concat([this.buffer, data]);
		console.log('Total buffer size:', this.buffer.length);
		
		while (this.buffer.length >= 4) {
			const message_id = this.buffer.readUInt32LE(0);
			console.log('Parsed message ID:', message_id);
			
			const header_size = this.get_header_size(message_id);
			console.log('Expected header size:', header_size);
			
			if (header_size === 0) {
				console.error(`Unknown message ID: ${message_id}`);
				console.log('Buffer contents (hex):', this.buffer.slice(0, Math.min(16, this.buffer.length)).toString('hex'));
				this.buffer = this.buffer.slice(4);
				continue;
			}
			
			if (this.buffer.length < 4 + header_size) {
				console.log('Waiting for more data. Have:', this.buffer.length, 'Need:', 4 + header_size);
				break; // Wait for more data
			}
			
			const header_buffer = this.buffer.slice(4, 4 + header_size);
			this.buffer = this.buffer.slice(4 + header_size);
			
			console.log('Dispatching message ID:', message_id, 'with header size:', header_buffer.length);
			this.dispatch_message(message_id, header_buffer);
		}
	}
	
	get_header_size(message_id) {
		switch (message_id) {
			case IpcMessageId.HANDSHAKE_REQUEST:
				return 64 + 32 + 32 + 32 + 8;
			case IpcMessageId.HANDSHAKE_RESPONSE:
				return 32 + 8;
			default:
				return 0;
		}
	}
	
	dispatch_message(message_id, header_buffer) {
		console.log('Attempting to dispatch message ID:', message_id);
		
		if (!this.handlers[message_id]) {
			console.error(`No handler registered for message ID: ${message_id}`);
			console.log('Available handlers:', Object.keys(this.handlers));
			return;
		}
		
		try {
			switch (message_id) {
				case IpcMessageId.HANDSHAKE_REQUEST:
					{
						console.log('Parsing handshake request header...');
						const header = this.parse_handshake_request_header(header_buffer);
						console.log('Parsed handshake request:', header);
						this.handlers[message_id](header);
					}
					break;
				case IpcMessageId.HANDSHAKE_RESPONSE:
					{
						console.log('Parsing handshake response header...');
						const header = this.parse_handshake_response_header(header_buffer);
						console.log('Parsed handshake response:', header);
						this.handlers[message_id](header);
					}
					break;
				default:
					console.error(`Unknown message ID in dispatch: ${message_id}`);
					break;
			}
		} catch (error) {
			console.error(`Error in message handler for '${message_id}':`, error);
			console.error('Error stack:', error.stack);
		}
	}
	
	create_handshake_request_header(platform, electron_version, chrome_version, node_version) {
		console.log('Creating handshake request with:', { platform, electron_version, chrome_version, node_version });
		
		const header = Buffer.alloc(64 + 32 + 32 + 32 + 8);
		let offset = 0;
		
		// platform (64 bytes)
		console.log('Writing platform at offset:', offset);
		this.copy_string_to_buffer(platform, header, offset, 64);
		offset += 64;
		
		// electron_version (32 bytes)
		console.log('Writing electron_version at offset:', offset);
		this.copy_string_to_buffer(electron_version, header, offset, 32);
		offset += 32;
		
		// chrome_version (32 bytes)
		console.log('Writing chrome_version at offset:', offset);
		this.copy_string_to_buffer(chrome_version, header, offset, 32);
		offset += 32;
		
		// node_version (32 bytes)
		console.log('Writing node_version at offset:', offset);
		this.copy_string_to_buffer(node_version, header, offset, 32);
		offset += 32;
		
		// timestamp (8 bytes)
		const timestamp = Math.floor(Date.now() / 1000);
		console.log('Writing timestamp at offset:', offset, 'value:', timestamp);
		header.writeBigInt64LE(BigInt(timestamp), offset);
		
		console.log('Created header with total size:', header.length);
		return header;
	}
	
	parse_handshake_response_header(buffer) {
		console.log('Parsing handshake response, buffer size:', buffer.length);
		console.log('Buffer (hex):', buffer.toString('hex'));
		
		let offset = 0;
		
		// version (32 bytes)
		console.log('Reading version at offset:', offset);
		const version = this.get_string_from_buffer(buffer, offset, 32);
		console.log('Parsed version:', version);
		offset += 32;
		
		// timestamp (8 bytes)
		console.log('Reading timestamp at offset:', offset);
		const timestamp = buffer.readBigInt64LE(offset);
		console.log('Parsed timestamp (raw):', timestamp);
		
		const result = {
			version: version,
			timestamp: Number(timestamp)
		};
		
		console.log('Final parsed handshake response:', result);
		return result;
	}
	
	parse_handshake_request_header(buffer) {
		let offset = 0;
		
		// platform (64 bytes)
		const platform = this.get_string_from_buffer(buffer, offset, 64);
		offset += 64;
		
		// electron_version (32 bytes)
		const electron_version = this.get_string_from_buffer(buffer, offset, 32);
		offset += 32;
		
		// chrome_version (32 bytes)
		const chrome_version = this.get_string_from_buffer(buffer, offset, 32);
		offset += 32;
		
		// node_version (32 bytes)
		const node_version = this.get_string_from_buffer(buffer, offset, 32);
		offset += 32;
		
		// timestamp (8 bytes)
		const timestamp = buffer.readBigInt64LE(offset);
		
		return {
			platform: platform,
			electron_version: electron_version,
			chrome_version: chrome_version,
			node_version: node_version,
			timestamp: Number(timestamp)
		};
	}
	
	copy_string_to_buffer(str, buffer, offset, max_length) {
		if (!str) return;
		
		const str_bytes = Buffer.from(str, 'utf8');
		const copy_length = Math.min(str_bytes.length, max_length - 1);
		str_bytes.copy(buffer, offset, 0, copy_length);
		buffer[offset + copy_length] = 0; // null terminator
	}
	
	get_string_from_buffer(buffer, offset, max_length) {
		const end_offset = offset + max_length;
		let null_index = buffer.indexOf(0, offset);
		
		if (null_index === -1 || null_index >= end_offset) {
			null_index = end_offset;
		}
		
		return buffer.slice(offset, null_index).toString('utf8');
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
	cli_ipc_client.register_handler(IpcMessageId.HANDSHAKE_RESPONSE, (header) => {
		console.log('HANDSHAKE RESPONSE HANDLER CALLED!');
		console.log('Received handshake response from core:', header);
		
		if (main_window) {
			console.log('Sending cli-handshake-complete event to renderer');
			main_window.webContents.send('cli-handshake-complete', {
				version: header.version,
				timestamp: new Date(header.timestamp * 1000).toISOString()
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