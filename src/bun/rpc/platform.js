import { Utils } from 'electrobun/bun';
import os from 'node:os';

export const platform_handlers = {
	async platform_open_path({ path }) {
		await Utils.openPath(path);
	},

	async platform_open_url({ url }) {
		await Utils.openExternal(url);
	},

	async platform_clipboard_write_text({ text }) {
		// TODO: electrobun clipboard API or fallback
		throw new Error('not implemented: clipboard write text');
	},

	async platform_clipboard_write_image({ data }) {
		throw new Error('not implemented: clipboard write image');
	},

	async platform_clipboard_read_text() {
		throw new Error('not implemented: clipboard read text');
	},

	async platform_show_open_dialog({ title, filters, default_path, multi }) {
		// TODO: wire to electrobun file dialog API
		throw new Error('not implemented: open dialog');
	},

	async platform_show_save_dialog({ title, filters, default_path }) {
		throw new Error('not implemented: save dialog');
	},

	async platform_get_gpu_info() {
		// TODO: migrate gpu-info.js detection logic
		return null;
	},

	async platform_get_screen_info() {
		// TODO: wire to electrobun Screen API
		return { width: 1920, height: 1080, scale: 1 };
	},
};
