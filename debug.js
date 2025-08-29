const fs = require('fs');
const childProcess = require('child_process');

const nwPath = './bin/win-x64-debug/nw.exe';

(async () => {
	// Check if nw.exe exists
	try {
		await fs.promises.access(nwPath);
	} catch (err) {
		throw new Error('Could not find debug executable at %s, ensure you have run `node build win-x64-debug` first.', nwPath);
	}

	// Launch nw.exe
	const nwProcess = childProcess.spawn(nwPath, { stdio: 'inherit' });

	// When the spawned process is closed, exit the Node.js process as well
	nwProcess.on('close', code => {
		process.exit(code);
	});
})();