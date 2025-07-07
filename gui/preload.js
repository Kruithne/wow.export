const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_api', {
	get_app_version: () => ipcRenderer.invoke('get-app-version'),
	
	send_cli_message: (message_id, data) => ipcRenderer.invoke('send-cli-message', message_id, data),
	
	on_cli_handshake: (callback) => ipcRenderer.on('cli-handshake-complete', callback),
	
	on_cli_spawn_error: (callback) => ipcRenderer.on('cli-spawn-error', callback),
	
	platform: process.platform,
	
	versions: {
		node: process.versions.node,
		chrome: process.versions.chrome,
		electron: process.versions.electron
	}
});