const _manifest = nw.App.manifest;
let _win = null;

module.exports = {
	// shell
	open_path: (path) => nw.Shell.openItem(path),
	open_url: (url) => nw.Shell.openExternal(url),

	// clipboard
	clipboard_write_text: (text) => nw.Clipboard.get().set(text, 'text'),
	clipboard_write_image: (base64_png) => nw.Clipboard.get().set(base64_png, 'png', true),

	// app info
	get_version: () => _manifest.version,
	get_flavour: () => _manifest.flavour,
	get_guid: () => _manifest.guid,
	get_data_path: () => nw.App.dataPath,
	get_argv: () => nw.App.argv,
	get_manifest: () => _manifest,

	// window management
	init_window() { _win = nw.Window.get(); return _win; },
	set_progress_bar: (val) => _win?.setProgressBar(val),
	show_dev_tools: () => _win?.showDevTools(),
	on_close: (fn) => _win?.on('close', fn),

	// app lifecycle
	reload: () => chrome.runtime.reload(),
};
