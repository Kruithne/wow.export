const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let main_window;

function create_window() {
	main_window = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			enableRemoteModule: false,
			nodeIntegration: false
		}
	});

	main_window.loadFile('index.html');

	if (process.argv.includes('--dev')) {
		main_window.webContents.openDevTools();
	}

	main_window.on('closed', () => {
		main_window = null;
	});
}

app.whenReady().then(() => {
	create_window();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			create_window();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

ipcMain.handle('get-app-version', () => {
	return app.getVersion();
});

ipcMain.handle('read-file', async (event, file_path) => {
	try {
		const data = await fs.promises.readFile(file_path, 'utf-8');
		return { success: true, data };
	} catch (error) {
		return { success: false, error: error.message };
	}
});

ipcMain.handle('write-file', async (event, file_path, content) => {
	try {
		await fs.promises.writeFile(file_path, content, 'utf-8');
		return { success: true };
	} catch (error) {
		return { success: false, error: error.message };
	}
});