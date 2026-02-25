import { electrobun, app, on } from './rpc.js';
import { MSG } from '../../rpc/schema.js';

document.addEventListener('DOMContentLoaded', async () => {
	const version_el = document.getElementById('version');
	const info_el = document.getElementById('runtime-info');

	try {
		const info = await app.get_info();
		version_el.textContent = 'v' + info.version;
		info_el.textContent = `Renderer: CEF | Flavour: ${info.flavour}`;
	} catch {
		version_el.textContent = 'v0.2.14';
		info_el.textContent = 'Renderer: CEF | RPC: pending';
	}

	on(MSG.TOAST, ({ message, type }) => {
		console.log(`[toast:${type ?? 'info'}] ${message}`);
	});
});
