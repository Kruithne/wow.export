const fsp = require('fs').promises;
const constants = require('./constants');
const generics = require('./generics');
const tactKeys = require('./casc/tact-keys');
const core = require('./core');
const log = require('./log');

let isSaving = false;
let isQueued = false;
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
	} else {
		// Queue another save.
		isQueued = true;
	}
};

/**
 * Persist configuration data to disk.
 */
const doSave = async () => {
	try {
		const configSave = {};
		for (const [key, value] of Object.entries(core.view.config)) {
			// Only persist configuration values that do not match defaults.
			if (defaultConfig.hasOwnProperty(key) && defaultConfig[key] === value)
				continue;

			configSave[key] = value;
		}

		const out = JSON.stringify(configSave, null, '\t');
		await fsp.writeFile(constants.CONFIG.USER_PATH, out, 'utf8');
	} catch (e) {
		crash('ERR_CONFIG_SAVE', e.message);
	}
	
	// If another save was attempted during this one, re-save.
	if (isQueued) {
		isQueued = false;
		doSave();
	} else {
		isSaving = false;
	}
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

	if (cfg.exportDirectory.length === 0)
		return core.setToast('error', 'A valid export directory must be provided');

	if (cfg.listfileURL.length === 0 || !cfg.listfileURL.startsWith('http'))
		return core.setToast('error', 'A valid listfile URL is required.', { 'Use Default': () => cfg.listfileURL = defaultConfig.listfileURL });

	if (cfg.tactKeysURL.length === 0 || !cfg.tactKeysURL.startsWith('http'))
		return core.setToast('error', 'A valid URL is required for encryption key updates.', { 'Use Default': () => cfg.tactKeysURL = defaultConfig.tactKeysURL });

	// Everything checks out, apply.
	core.view.config = cfg;
	core.view.showPreviousScreen();
	core.setToast('success', 'Changes to your configuration have been saved!');
});

// User has attempted to manually add an encryption key.
// Verify the input, register it to BLTEReader and store with keys.
core.events.on('click-tact-key', () => {
	if (tactKeys.addKey(core.view.userInputTactKeyName, core.view.userInputTactKey))
		core.setToast('success', 'Successfully added decryption key.');
	else
		core.setToast('error', 'Invalid encryption key.');
});

// When the user clicks 'Discard' on the configuration screen, simply
// move back to the previous screen on the stack.
core.events.on('click-config-discard', () => core.view.showPreviousScreen());

// When the user clicks 'Reset to Default', apply the default configuration to our
// reactive edit object instead of our normal config allowing them to still discard.
core.events.on('click-config-reset', () => {
	core.view.configEdit = Object.assign({}, defaultConfig);
});

module.exports = { load };