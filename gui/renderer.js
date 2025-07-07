document.addEventListener('DOMContentLoaded', async () => {
	await load_system_info();
	setup_event_listeners();
	setup_cli_communication();
});

async function load_system_info() {
	try {
		const app_version = await window.electron_api.get_app_version();
		document.getElementById('app-version').textContent = `v${app_version}`;
		
		document.getElementById('platform-info').textContent = window.electron_api.platform;
		document.getElementById('node-version').textContent = window.electron_api.versions.node;
		document.getElementById('chrome-version').textContent = window.electron_api.versions.chrome;
		document.getElementById('electron-version').textContent = window.electron_api.versions.electron;
	} catch (error) {
		console.error('Error loading system info:', error);
	}
}

function setup_event_listeners() {
	const read_file_btn = document.getElementById('read-file-btn');
	const write_file_btn = document.getElementById('write-file-btn');
	const file_path_input = document.getElementById('file-path');
	const file_content_textarea = document.getElementById('file-content');

	read_file_btn.addEventListener('click', async () => {
		const file_path = file_path_input.value.trim();
		if (!file_path) {
			alert('Please enter a file path');
			return;
		}

		try {
			const result = await window.electron_api.read_file(file_path);
			if (result.success) {
				file_content_textarea.value = result.data;
			} else {
				alert(`Error reading file: ${result.error}`);
			}
		} catch (error) {
			console.error('Error reading file:', error);
			alert('Error reading file');
		}
	});

	write_file_btn.addEventListener('click', async () => {
		const file_path = file_path_input.value.trim();
		const content = file_content_textarea.value;
		
		if (!file_path) {
			alert('Please enter a file path');
			return;
		}

		try {
			const result = await window.electron_api.write_file(file_path, content);
			if (result.success) {
				alert('File written successfully');
			} else {
				alert(`Error writing file: ${result.error}`);
			}
		} catch (error) {
			console.error('Error writing file:', error);
			alert('Error writing file');
		}
	});
}

function setup_cli_communication() {
	window.electron_api.on_cli_handshake((event, data) => {
		console.log('CLI handshake completed:', data);
		
		const handshake_info = document.getElementById('handshake-info');
		if (handshake_info) {
			handshake_info.textContent = `CLI Connected - Version: ${data.version}, Time: ${data.timestamp}`;
			handshake_info.style.color = 'green';
		}
	});
	
	window.electron_api.on_cli_spawn_error((event, error_message) => {
		console.error('CLI spawn error:', error_message);
		
		const handshake_info = document.getElementById('handshake-info');
		if (handshake_info) {
			handshake_info.textContent = `CLI Error: ${error_message}`;
			handshake_info.style.color = 'red';
		}
	});
}