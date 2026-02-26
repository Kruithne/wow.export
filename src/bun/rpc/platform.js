import { Utils, Screen } from 'electrobun/bun';
import os from 'node:os';
import { get_platform_gpu_info } from '../lib/gpu-info.js';

export const platform_handlers = {
	async platform_open_path({ path }) {
		await Utils.openPath(path);
	},

	async platform_open_url({ url }) {
		await Utils.openExternal(url);
	},

	async platform_clipboard_write_text({ text }) {
		await Utils.clipboardWriteText(text);
	},

	async platform_clipboard_read_text() {
		return await Utils.clipboardReadText();
	},

	async platform_clipboard_write_image({ data }) {
		await Utils.clipboardWriteImage(data);
	},

	async platform_show_open_dialog({ title, filters, default_path, multi }) {
		try {
			const result = await Utils.openFileDialog({ title, filters, defaultPath: default_path, multiple: multi });
			return result;
		} catch {
			return null;
		}
	},

	async platform_show_save_dialog({ title, filters, default_path }) {
		try {
			const result = await Utils.saveFileDialog({ title, filters, defaultPath: default_path });
			return result;
		} catch {
			return null;
		}
	},

	async platform_get_gpu_info() {
		return await get_platform_gpu_info();
	},

	async platform_get_screen_info() {
		const display = Screen.getPrimaryDisplay();
		return { width: display.bounds.width, height: display.bounds.height, scale: display.scaleFactor };
	},
};
