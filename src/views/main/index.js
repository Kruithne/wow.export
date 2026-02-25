import { Electroview } from 'electrobun/view';

const rpc = Electroview.defineRPC({
	maxRequestTime: 5000,
	handlers: {
		requests: {},
		messages: {},
	},
});

const electrobun = new Electroview({ rpc });

document.addEventListener('DOMContentLoaded', () => {
	const version_el = document.getElementById('version');
	version_el.textContent = 'v0.2.14';

	const info_el = document.getElementById('runtime-info');
	info_el.textContent = 'Renderer: CEF | View protocol: views://main/';
});
