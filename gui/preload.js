const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_api', {
	get_app_version: () => ipcRenderer.invoke('get-app-version'),
	
	read_file: (file_path) => ipcRenderer.invoke('read-file', file_path),
	
	write_file: (file_path, content) => ipcRenderer.invoke('write-file', file_path, content),
	
	platform: process.platform,
	
	versions: {
		node: process.versions.node,
		chrome: process.versions.chrome,
		electron: process.versions.electron
	}
});