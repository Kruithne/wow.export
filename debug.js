const fs = require('fs');
const path = require('path');
const sass = require('sass');
const childProcess = require('child_process');

const nwPath = './bin/win-x64-debug/nw.exe';
const srcDir = './src/';
const appScss = './src/app.scss';

(async () => {
	// Check if nw.exe exists
	try {
		await fs.promises.access(nwPath);
	} catch (err) {
		throw new Error('Could not find debug executable at %s, ensure you have run `node build win-x64-debug` first.', nwPath);
	}

	// Locate all .scss files under /src/
	const scssFiles = (await fs.promises.readdir(srcDir)).filter(file => file.endsWith('.scss'));

	// Recompile app.scss on startup.
	try {
		const result = sass.compile(appScss);
		await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
	} catch (err) {
		console.error('Failed to compile application css: %s', err);
	}

	// Monitor the .scss files for changes
	scssFiles.forEach(file => {
		fs.watchFile(path.join(srcDir, file), async () => {
			console.log('Detected change in %s, recompiling...', file);
			// If there are any changes in any of the .scss files, recompile app.scss.
			try {
				const result = sass.compile(appScss);
				await fs.promises.writeFile(appScss.replace('.scss', '.css'), result.css);
			} catch (err) {
				console.error('Failed to compile application css: %s', err);
			}
		});
	});

	// Launch nw.exe
	const nwProcess = childProcess.spawn(nwPath, { stdio: 'inherit' });

	// When the spawned process is closed, exit the Node.js process as well
	nwProcess.on('close', code => {
		process.exit(code);
	});
})();