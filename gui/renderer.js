document.addEventListener('DOMContentLoaded', async () => {
	await load_system_info();
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