import { promises as fsp, rmSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import waitOn from 'wait-on';
import { createServer } from 'net';

const argv = process.argv.splice(2);
if (argv[0] == null) {
	console.log('Please supply a platform like win, linux or osx');
	process.exit(1);
}
const platform = argv[0];
const serverPort = argv[1] ?? 4175;

let nwPath = `./bin/${platform}-x64-debug-hmr/nw`;
if (platform === 'win') {
	nwPath += '.exe';
} else {
	rmSync('/tmp/wow.export-debug-window.sock', {force: true});
	rmSync('/tmp/wow.export-main-window.sock', {force: true});
}

// Check if nw.exe exists
try {
	await fsp.access(nwPath);
} catch (err) {
	throw new Error(`Could not find debug executable at '${nwPath}', ensure you have run 'node build ${platform}-x64-debug-hmr' first.`);
}

// Launch vite
const viteProcess = spawn('bun', ['run', 'vite'], {
	stdio: 'inherit',
	env: {
		...process.env,
		SERVER_PORT: serverPort,
		PLATFORM: platform,
	}
});

await waitOn({
	resources: [`http-get://localhost:${serverPort}`],
	headers: { 'accept': 'text/html' },
});

const debugSocketPath = platform === 'win'
	? path.join('\\\\?\\pipe' , nwPath, 'debug-window')
	: '/tmp/wow.export-debug-window.sock';

let debugSocket;
const debugServer = createServer().listen(debugSocketPath);
debugServer.on('connection', async (socket) => { debugSocket = socket; });
process.on('SIGINT', async function () {
	debugSocket?.write('please_exit');
	setTimeout(process.exit, 500);
});

// Launch nw.exe
const nwProcess = spawn(nwPath, {
	stdio: 'inherit',
	env: {
		...process.env,
		DEBUG_SOCKET: debugSocketPath,
		SERVER_PORT: serverPort,
		PLATFORM: platform,
	}
});

// When the spawned process is closed, exit the Node.js process as well
nwProcess.on('close', code => {
	viteProcess.kill('SIGINT');
	process.exit(code);
});
