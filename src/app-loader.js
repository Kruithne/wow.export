(async function () {
	await mainWindow.isReady;
	await import('./app.mjs');
})();