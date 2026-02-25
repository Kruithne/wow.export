import { BrowserWindow, BrowserView } from 'electrobun/bun';

const rpc = BrowserView.defineRPC({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {},
	},
});

const win = new BrowserWindow({
	title: 'wow.export',
	url: 'views://main/index.html',
	renderer: 'cef',
	frame: { width: 1200, height: 800, x: 100, y: 100 },
	titleBarStyle: 'default',
	transparent: false,
	sandbox: false,
	rpc,
});
