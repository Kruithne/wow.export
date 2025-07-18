function is_debug_mode() {
	const { app } = require('electron');
	
	if (!app.isPackaged)
		return true;
	
	if (process.argv.includes('--dev'))
		return true;
	
	return false;
}

module.exports = { is_debug_mode };