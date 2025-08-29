/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import path from 'node:path';
import manifest from './package.json';

const ENDPOINT_BASE = 'wss://kruithne.net/wow.export/v2';

const BUILD_DIR = path.join(__dirname, 'bin');
const PUBLISH_BUILDS = ['win-x64'];

for (const build_tag of PUBLISH_BUILDS) {
	try {
		console.log(`publishing build ${build_tag}...`);

		const update_key = process.env.WOW_EXPORT_V2_UPDATE_KEY;
		if (update_key === undefined)
			throw new Error('environment var WOW_EXPORT_V2_UPDATE_KEY not defined');

		const build_dir_path = path.join(BUILD_DIR, build_tag);
		const build_dir = Bun.file(build_dir_path);
		await build_dir.stat(); // existence check

		const update_file_path = path.join(build_dir_path, 'update');
		const update_file = Bun.file(update_file_path);
		await update_file.stat(); // existence check

		const update_manifest = Bun.file(update_file_path + '.json');
		await update_manifest.stat(); // existence check

		const m_size = update_manifest.size;
		const c_size = update_file.size;
		const t_size = m_size + c_size;

		const data = new ArrayBuffer(t_size);

		const update_file_data = await update_file.arrayBuffer();
		const update_manifest_data = await update_manifest.arrayBuffer();

		const view = new Uint8Array(data);
		view.set(new Uint8Array(update_file_data), 0);
		view.set(new Uint8Array(update_manifest_data), update_file.size);

		console.log({ m_size, c_size, t_size });
		console.log(`uploading update data via WebSocket...`);

		const ws_url = `${ENDPOINT_BASE}/trigger_update/test/${m_size}/${c_size}`;
		
		const socket = new WebSocket(ws_url, {
			headers: {
				authorization: update_key
			}
		});

		await new Promise((resolve, reject) => {
			let uploaded_bytes = 0;
			let last_logged_progress = 0;
			let current_chunk_index = 0;
			let ack_timeout = null;
			const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
			const ACK_TIMEOUT = 30000; // 30 seconds timeout for ack
			const chunks = [];
			
			// Pre-slice all chunks
			for (let start = 0; start < t_size; start += CHUNK_SIZE) {
				const end = Math.min(start + CHUNK_SIZE, t_size);
				chunks.push(data.slice(start, end));
			}
			
			function sendNextChunk() {
				if (current_chunk_index >= chunks.length) {
					console.log('All chunks sent, closing connection');
					socket.close();
					return;
				}
				
				const chunk = chunks[current_chunk_index];
				console.log(`Sending chunk ${current_chunk_index + 1}/${chunks.length} (${chunk.byteLength} bytes)`);
				socket.send(chunk);
				uploaded_bytes += chunk.byteLength;
				current_chunk_index++;
				
				const progress = Math.floor((uploaded_bytes / t_size) * 100);
				if (progress >= last_logged_progress + 10 || uploaded_bytes >= t_size) {
					console.log(`Upload progress: ${progress}% (${uploaded_bytes}/${t_size} bytes)`);
					last_logged_progress = progress;
				}
				
				// Set timeout for ack
				if (current_chunk_index < chunks.length) {
					ack_timeout = setTimeout(() => {
						console.log(`Timeout waiting for ack after chunk ${current_chunk_index}`);
						socket.close(1002, 'Ack timeout');
					}, ACK_TIMEOUT);
				}
			}
			
			socket.onopen = () => {
				console.log('WebSocket connection established');
				sendNextChunk(); // Send first chunk
			};
			
			socket.onmessage = (event) => {
				if (event.data === 'ack') {
					console.log(`Received ack for chunk ${current_chunk_index}`);
					if (ack_timeout) {
						clearTimeout(ack_timeout);
						ack_timeout = null;
					}
					sendNextChunk(); // Send next chunk after acknowledgment
				} else {
					console.log(`Unexpected message from server: ${event.data}`);
				}
			};

			socket.onerror = (error) => {
				reject(new Error(`WebSocket error: ${error.message || 'Unknown error'}`));
			};

			socket.onclose = (event) => {
				console.log(`WebSocket closed: code=${event.code}, reason="${event.reason}", chunks sent=${current_chunk_index}/${chunks.length}`);
				if (event.code === 1000) {
					resolve();
				} else {
					reject(new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`));
				}
			};
		});

		console.log(`successfully published build ${build_tag}`);

		// await update_file.delete();
		// await update_manifest.delete();
	
		// todo: create ZIP archive and upload that too.
	} catch (e) {
		console.error(`failed to publish build ${build_tag}: ${e.message}`);
	}
}