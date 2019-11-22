const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

let isSaving = false;
let defaultConfig = {};

/**
 * Load configuration from disk.
 */
const load = async () => {
	defaultConfig = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};
	const userConfig = await generics.readJSON(constants.CONFIG.USER_PATH) || {};

	log.write('Loaded config defaults: %o', defaultConfig);
	log.write('Loaded user config: %o', userConfig);

	const config = Object.assign({}, defaultConfig, userConfig);
	core.view.config = config;

	core.view.$watch('config', () => save(), { deep: true });
};

/**
 * Mark configuration for saving.
 */
const save = () => {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	}
};

/**
 * Persist configuration data to disk.
 */
const doSave = async () => {
	try {
		const out = JSON.stringify(core.view.config, null, '\t');
		await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');
	} catch (e) {
		crash('ERR_CONFIG_SAVE', e.message);
	}
	
	isSaving = false;
};

// Track when the configuration screen is displayed and clone a copy of
// the current configuration into core.view.configEdit for reactive UI usage.
core.events.on('screen-config', () => {
	core.view.configEdit = Object.assign({}, core.view.config);
});

// When the user attempts to apply a new configuration, verify all of the
// new values as needed before applying them.
core.events.on('click-config-apply', () => {
	const cfg = core.view.configEdit;

	if (cfg.listfileURL.length === 0 || !cfg.listfileURL.startsWith('http'))
		return core.setToast('error', 'A valid listfile URL is required.', { 'Use Default': () => cfg.listfileURL = defaultConfig.listfileURL }, 10000);

	if (cfg.tactKeysURL.length === 0 || !cfg.tactKeysURL.startsWith('http'))
		return core.setToast('error', 'A valid URL is required for encryption key updates.', { 'Use Default': () => cfg.tactKeysURL = defaultConfig.tactKeysURL }, 10000);

	// Everything checks out, apply.
	core.view.config = cfg;
	core.showPreviousScreen();
	core.setToast('success', 'Changes to your configuration have been saved!', {}, 10000);
});

// When the user clicks 'Discard' on the configuration screen, simply
// move back to the previous screen on the stack.
core.events.on('click-config-discard', () => core.showPreviousScreen());

// When the user clicks 'Reset to Default', apply the default configuration to our
// reactive edit object instead of our normal config allowing them to still discard.
core.events.on('click-config-reset', () => {
	core.view.configEdit = Object.assign({}, defaultConfig);
});

module.exports = { load };