// BUILD_RELEASE will be set globally by Terser during bundling allowing us
// to discern a production build. However, for debugging builds it will throw
// a ReferenceError without the following check. Any code that only runs when
// BUILD_RELEASE is set to false will be removed as dead-code during compile.
BUILD_RELEASE = typeof BUILD_RELEASE !== 'undefined';

/**
 * crash() is used to inform the user that the application has exploded.
 * It is purposely global and primitive as we have no idea what state
 * the application will be in when it is called.
 * @param {string} errorCode
 * @param {string} errorText
 */
let isCrashed = false;
crash = (errorCode, errorText) => {
    // Prevent a never-ending cycle of depression.
    if (isCrashed)
        return;

    isCrashed = true;

    // Replace the entire markup with just that from the <noscript> block.
    const errorMarkup = document.querySelector('noscript').innerHTML;
    const body = document.querySelector('body');
    body.innerHTML = errorMarkup;

    // Keep the logo, because that's cool.
    const logo = document.createElement('div');
    logo.setAttribute('id', 'logo-background');
    document.body.appendChild(logo);

    // Display our error code/text.
    document.querySelector('#crash-screen-text-code').textContent = errorCode;
    document.querySelector('#crash-screen-text-message').textContent = errorText;

    // Grab the runtime log if available.
    if (typeof getErrorDump === 'function')
        getErrorDump().then(data => document.querySelector('#crash-screen-log').textContent = data);
};

// Register crash handlers.
process.on('unhandledRejection', e => crash('ERR_UNHANDLED_REJECTION', e.message));
process.on('uncaughtException', e => crash('ERR_UNHANDLED_EXCEPTION', e.message));

// Imports
const os = require('os');
const constants = require('./js/constants');
const generics = require('./js/generics');
const updater = require('./js/updater');
const core = require('./js/core');
const log = require('./js/log');

// Prevent files from being dropped onto the window.
// GH-2: Implement drag-and-drop support.
window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

// Launch DevTools for debug builds.
if (!BUILD_RELEASE)
    nw.Window.get().showDevTools();

// Force all links to open in the users default application.
document.addEventListener('click', function(e) {
    if (!e.target.matches('[data-external]'))
        return;

    e.preventDefault();
    nw.Shell.openExternal(e.target.getAttribute('data-external'));
});

(async () => {
    // Wait for the DOM to be loaded.
    if (document.readyState === 'loading')
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

    // Append the application version to the title bar.
    document.title += ' v' + nw.App.manifest.version;

    // Interlink error handling for Vue.
    Vue.config.errorHandler = err => crash('ERR_VUE', err.message);

    // Initialize Vue.
    core.view = new Vue({
        el: '#container',
        data: core.view,
        methods: {
            /**
             * Invoked when a toast option is clicked.
             * The tag is passed to our global event emitter.
             * @param {string} tag 
             */
            handleToastOptionClick: function(tag) {
                this.toast = null;
                core.events.emit(tag);
            }
        }
    });

    // Log some basic information for potential diagnostics.
    const manifest = nw.App.manifest;
    const cpus = os.cpus();
    log.write('wow.export has started v%s %s [%s]', manifest.version, manifest.flavour, manifest.guid);
    log.write('Host %s (%s), CPU %s (%d cores), Memory %s / %s', os.platform, os.arch, cpus[0].model, cpus.length, generics.filesize(os.freemem), generics.filesize(os.totalmem));
    log.write('INSTALL_PATH %s DATA_PATH %s', constants.INSTALL_PATH, constants.DATA_PATH);

    // Check for updates (without blocking).
    if (BUILD_RELEASE) {
        updater.checkForUpdates().then(updateAvailable => {
            if (updateAvailable) {
                core.events.once('toast-accept-update', () => updater.applyUpdate());

                core.view.toast = {
                    type: 'info',
                    message: 'A new update is available. You should update, it\'s probably really cool.',
                    options: {
                        'toast-accept-update': 'Update Now',
                        'toast-dismiss': 'Maybe Later'
                    }
                };
            }
        });
    }
})();