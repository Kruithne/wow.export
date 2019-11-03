const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');
const log = require('./log');

const config = core.view.config;

(async () => {
    const defaultConfig = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};
    const userConfig = await generics.readJSON(constants.CONFIG.USER_PATH) || {};

    log.write('Loaded config defaults: %o', defaultConfig);
    log.write('Loaded user config: %o', userConfig);

    Object.assign(config, defaultConfig);
    Object.assign(config, userConfig);
})();

// ToDo: Create functions allowing access/setting of config values.
// ToDo: Auto-save configuration values (buffer by a tick).