const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MESSAGE_TYPE_JSON = 0x4A534F4E;
const MESSAGE_TYPE_CBIN = 0x4342494E;

let main_window;
let cli_process;
let cli_ipc_client;

class CliIpcClient {
	constructor() {
		this.handlers = {};
		this.pending_binaries = {};
		this.pending_messages = {};
	}
	
	register_handler(message_id, handler) {
		this.handlers[message_id] = handler;
	}
	
	send_message(message_id, data = null, binary_chunks = null) {
		const message = {
			id: message_id,
			data: data
		};
		
		if (binary_chunks && binary_chunks.length > 0) {
			message.cbin = binary_chunks.map(chunk => chunk.uuid);
		}
		
		const json_string = JSON.stringify(message);
		const json_bytes = Buffer.from(json_string, 'utf-8');
		
		this.write_message(MESSAGE_TYPE_JSON, json_bytes);
		
		if (binary_chunks) {
			for (const chunk of binary_chunks) {
				this.write_message(MESSAGE_TYPE_CBIN, chunk.data);
			}
		}
	}
	
	write_message(type, data) {
		console.log(`Sending message: type=0x${type.toString(16)}, length=${data.length}`);
		
		const type_buffer = Buffer.alloc(4);
		type_buffer.writeUInt32LE(type, 0);
		
		const length_buffer = Buffer.alloc(4);
		length_buffer.writeUInt32LE(data.length, 0);
		
		console.log(`Header bytes: ${Buffer.concat([type_buffer, length_buffer]).toString('hex')}`);
		
		cli_process.stdin.write(type_buffer);
		cli_process.stdin.write(length_buffer);
		cli_process.stdin.write(data);
	}
	
	handle_stdout_data(data) {
		if (data.length >= 8) {
			const type = data.readUInt32LE(0);
			const length = data.readUInt32LE(4);
			
			console.log(`Received header: type=0x${type.toString(16)}, length=${length}`);
			
			if (data.length >= 8 + length) {
				const payload = data.slice(8, 8 + length);
				
				if (type === MESSAGE_TYPE_JSON) {
					this.handle_json_message(payload);
				} else if (type === MESSAGE_TYPE_CBIN) {
					this.handle_binary_message(payload);
				}
			}
		}
	}
	
	handle_json_message(payload) {
		try {
			const json_string = payload.toString('utf-8');
			const message = JSON.parse(json_string);
			
			if (!message.id) {
				console.error('Received JSON message without ID');
				return;
			}
			
			console.log('Received JSON message:', message);
			
			if (!message.cbin || message.cbin.length === 0) {
				this.process_message(message, []);
			} else {
				const message_key = Math.random().toString(36).substr(2, 9);
				this.pending_messages[message_key] = {
					message: message,
					awaiting_uuids: [...message.cbin]
				};
				this.check_pending_message(message_key);
			}
		} catch (error) {
			console.error('Error processing JSON message:', error);
		}
	}
	
	handle_binary_message(payload) {
		try {
			const uuid = payload.slice(0, 36).toString('utf-8');
			const binary_data = payload.slice(36);
			
			const chunk = {
				uuid: uuid,
				data: binary_data
			};
			
			this.pending_binaries[uuid] = chunk;
			this.check_all_pending_messages();
		} catch (error) {
			console.error('Error processing binary message:', error);
		}
	}
	
	check_all_pending_messages() {
		for (const message_key of Object.keys(this.pending_messages)) {
			this.check_pending_message(message_key);
		}
	}
	
	check_pending_message(message_key) {
		const pending = this.pending_messages[message_key];
		if (!pending) return;
		
		pending.awaiting_uuids = pending.awaiting_uuids.filter(uuid => 
			!this.pending_binaries[uuid]
		);
		
		if (pending.awaiting_uuids.length === 0) {
			const binary_chunks = pending.message.cbin
				? pending.message.cbin
					.filter(uuid => this.pending_binaries[uuid])
					.map(uuid => this.pending_binaries[uuid])
				: [];
			
			this.process_message(pending.message, binary_chunks);
			
			if (pending.message.cbin) {
				for (const uuid of pending.message.cbin) {
					delete this.pending_binaries[uuid];
				}
			}
			
			delete this.pending_messages[message_key];
		}
	}
	
	process_message(message, binary_chunks) {
		if (this.handlers[message.id]) {
			try {
				this.handlers[message.id](message, binary_chunks);
			} catch (error) {
				console.error(`Error in message handler for '${message.id}':`, error);
			}
		} else {
			console.error(`No handler registered for message ID: ${message.id}`);
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
	let cli_path;
	
	if (process.platform === 'win32') {
		cli_path = 'wow_export_cli.exe';
	} else {
		cli_path = 'wow_export_cli';
	}
	
	console.log('Spawning CLI process:', cli_path);
	
	if (!fs.existsSync(cli_path)) {
		console.error('CLI executable not found at:', cli_path);
		if (main_window)
			main_window.webContents.send('cli-spawn-error', `CLI executable not found at: ${cli_path}`);

		return;
	}
	
	cli_process = spawn(cli_path, ['--context=ipc'], {
		stdio: ['pipe', 'pipe', 'pipe']
	});
	
	cli_ipc_client = new CliIpcClient();
	
	cli_ipc_client.register_handler('HANDSHAKE_RESPONSE', (message, binary_chunks) => {
		console.log('Received handshake response from CLI:', message);
		
		if (main_window)
			main_window.webContents.send('cli-handshake-complete', message.data);
	});
	
	cli_process.stdout.on('data', (data) => {
		cli_ipc_client.handle_stdout_data(data);
	});
	
	cli_process.stderr.on('data', (data) => {
		console.error('CLI stderr:', data.toString());
	});
	
	cli_process.on('close', (code) => {
		console.log(`CLI process exited with code ${code}`);
	});
	
	cli_process.on('error', (error) => {
		console.error('CLI process error:', error);
	});
	
	setTimeout(() => {
		const test_value = Math.random().toString(36).substring(2, 15);
		console.log('Sending handshake to CLI with test value:', test_value);
		
		cli_ipc_client.send_message('HANDSHAKE', {
			test_value: test_value,
			timestamp: new Date().toISOString(),
			versions: {
				platform: process.platform,
				electron: process.versions.electron,
				chrome: process.versions.chrome,
				node: process.versions.node
			}
		});
	}, 1000);
}

ipcMain.handle('send-cli-message', (event, message_id, data) => {
	if (cli_ipc_client) {
		cli_ipc_client.send_message(message_id, data);
		return { success: true };
	}
	return { success: false, error: 'CLI not connected' };
});