/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// BUILD_RELEASE will be set globally by Terser during bundling allowing us
// to discern a production build. However, for debugging builds it will throw
// a ReferenceError without the following check. Any code that only runs when
// BUILD_RELEASE is set to false will be removed as dead-code during compile.
BUILD_RELEASE = typeof BUILD_RELEASE !== 'undefined';

if (!BUILD_RELEASE && typeof chrome.runtime === 'undefined') {
	require('./js/init-hmr');
} else {
	const win = nw.Window.get();
	win.on('close', () => process.exit()); // Ensure we exit when window is closed.

	if (!BUILD_RELEASE)
		win.showDevTools();

	// Debugging reloader.
	if (!BUILD_RELEASE) {
		window.addEventListener('keyup', e => {
			if (e.code === 'F5')
				chrome.runtime.reload();
		});
	}

	mainWindow = {
		setProgressBar(value) {
			nw.Window.get().setProgressBar(value);
		},
		isReady: new Promise((resolve) => resolve()),
		Shell: {
			openItem: nw.Shell.openItem
		}
	};
}
