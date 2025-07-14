#!/usr/bin/env bun

import { join } from 'path';
import { homedir } from 'os';
import { createReadStream, watchFile, unwatchFile, existsSync, statSync } from 'fs';

function get_runtime_log_path() {
	let base_path;
	
	if (process.platform === 'win32') {
		base_path = process.env.APPDATA;
	} else if (process.platform === 'darwin') {
		base_path = join(homedir(), 'Library', 'Application Support');
	} else {
		base_path = join(homedir(), '.local', 'share');
	}
	
	return join(base_path, 'wow.export', 'runtime.log');
}

class RuntimeLogTail {
	constructor() {
		this.log_path = get_runtime_log_path();
		this.file_position = 0;
		this.is_watching = false;
		this.read_stream = null;
	}

	async start() {
		console.log(`Tailing runtime log: ${this.log_path}`);
		
		// Check if file exists initially
		if (!existsSync(this.log_path)) {
			console.log('Log file does not exist yet, waiting...');
		} else {
			// Read existing content first
			await this.read_from_position();
		}
		
		// Start watching for changes
		this.start_watching();
		
		// Handle graceful shutdown
		process.on('SIGINT', () => {
			console.log('\nStopping tail...');
			this.stop();
			process.exit(0);
		});
	}

	start_watching() {
		if (this.is_watching) return;
		
		this.is_watching = true;
		watchFile(this.log_path, { interval: 100 }, (curr, prev) => {
			if (!existsSync(this.log_path)) {
				// File was deleted
				this.file_position = 0;
				return;
			}
			
			// Check if file was truncated (cleared)
			if (curr.size < this.file_position) {
				this.file_position = 0;
			}
			
			// Read new content if file size changed
			if (curr.size !== prev.size) {
				this.read_from_position();
			}
		});
	}

	async read_from_position() {
		if (!existsSync(this.log_path)) return;
		
		try {
			const stats = statSync(this.log_path);
			if (stats.size <= this.file_position) return;
			
			const stream = createReadStream(this.log_path, {
				start: this.file_position,
				encoding: 'utf8'
			});
			
			let buffer = '';
			
			stream.on('data', (chunk) => {
				buffer += chunk;
				const lines = buffer.split('\n');
				
				// Keep the last incomplete line in buffer
				buffer = lines.pop() || '';
				
				// Output complete lines
				lines.forEach(line => {
					if (line.trim()) {
						console.log(line);
					}
				});
			});
			
			stream.on('end', () => {
				// Output any remaining content
				if (buffer.trim()) {
					console.log(buffer);
				}
				this.file_position = stats.size;
			});
			
			stream.on('error', (error) => {
				console.error('Error reading log file:', error.message);
			});
			
		} catch (error) {
			console.error('Error accessing log file:', error.message);
		}
	}

	stop() {
		if (this.is_watching) {
			unwatchFile(this.log_path);
			this.is_watching = false;
		}
		
		if (this.read_stream) {
			this.read_stream.destroy();
			this.read_stream = null;
		}
	}
}

async function main() {
	const tail = new RuntimeLogTail();
	await tail.start();
	
	// Keep the process running
	await new Promise(() => {});
}

if (import.meta.main) {
	main().catch((error) => {
		console.error('Tail failed:', error.message);
		process.exit(1);
	});
}