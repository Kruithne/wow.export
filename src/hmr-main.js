const net = require('node:net');
const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs');
const { Readable } = require('stream');
const msgpack = require('@msgpack/msgpack');
const BuildCache = require('./js/casc/build-cache');

const win = nw.Window.get();
win.setProgressBar(-1); // Reset taskbar progress in-case it's stuck.
win.on('close', () => process.exit()); // Ensure we exit when window is closed.

const fetches = {};
let cache = null;

async function processFetch(id, url, init) {
	try {
		const res = await fetch(url, init);
		fetches[id] = res;
		const resData = {
			bodyUsed: false,
			headers: Object.fromEntries(res.headers.entries()),
			ok: true,
			redirected: res.redirected,
			status: res.status,
			statusText: res.statusText,
			type: res.type,
			url: res.url,
		};
		return {response: resData};
	} catch (e) {
		console.error(e);
		return {error: e.toString()};
	}
}

async function processFetchText(id) {
	id = id.toString();
	try {
		if (cache == null) {
			cache = new BuildCache('FETCH');
			await cache.init();
		}

		const text = await fetches[id].text();
		const dest = cache.getFilePath(id);
		await fsp.writeFile(dest, text, { flush: true });
		delete fetches[id];
		return {path: dest};
	} catch (e) {
		console.error(e);
		return {error: e.toString()};
	}
}

const mainWindowSocketPath = process.platform === 'win32'
	? path.join('\\\\?\\pipe', process.cwd(), 'main-window')
	: '/tmp/wow.export-main-window.sock';
if (process.platform !== 'win32' && fs.existsSync(mainWindowSocketPath))
	fs.unlinkSync(mainWindowSocketPath);
mainWindow = net.createServer().listen(mainWindowSocketPath);
mainWindow.on('connection', async (socket) => {
	socket.write(msgpack.encode({
		type: "nw.App",
		value: {
			dataPath: nw.App.dataPath,
			manifest: nw.App.manifest
		}
	}));

	const socketStream = Readable.from(socket, { objectMode: true });
	for await (const message of msgpack.decodeMultiStream(socketStream)) {
		console.log('main-window received:', message);

		switch (message.type) {
			case 'reload':
				chrome.runtime.reload();
				break;

			case 'setProgressBar':
				win.setProgressBar(message.value);
				break;

			case 'openItem':
				nw.Shell.openItem(message.value);
				break;

			case 'fetch':
				socket.write(msgpack.encode({
					type: 'fetchRes',
					id: message.id,
					result: await processFetch(message.id, message.url, message.init)
				}));
				break;

			case 'fetchText':
				socket.write(msgpack.encode({
					type: 'fetchTextRes',
					id: message.id,
					result: await processFetchText(message.id)
				}));
				break;

			case 'setClipboard':
				nw.Clipboard.get().set(message.value.data, message.value.type, message.value.raw);
				break;
		}
	}
});

const webview = document.createElement('webview');
webview.src = `http://localhost:${process.env.SERVER_PORT ?? 4175}`;
webview.allownw = true;
webview.partition = 'trusted';
document.body.appendChild(webview);

setTimeout(() => {
	document.querySelector('webview').showDevTools(true);
}, 100);
