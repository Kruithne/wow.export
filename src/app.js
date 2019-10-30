const Updater = require('./js/Updater');
const Core = require('./js/Core');

// Prevent files from being dropped onto the window.
// ToDo: Expand this to allow local conversion invokes via file drop?
window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

// Force all links to open in the users default application.
document.addEventListener('click', function(e) {
    if (!e.target.matches('a'))
        return;

    e.preventDefault();
    nw.Shell.openExternal(e.target.getAttribute('href'));
});

(async () => {
    // Wait for the DOM to be loaded.
    if (document.readyState === 'loading')
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

    // Append the application version to the title bar.
    document.title += ' v' + nw.App.manifest.version;

    // Initialize Vue.
    Core.View = new Vue({
        el: '#container',
        data: Core.View,
        methods: {
            /**
             * Invoked when a toast option is clicked.
             * The tag is passed to our global event emitter.
             * @param {string} tag 
             */
            handleToastOptionClick: function(tag) {
                this.toast = null;
                Core.Events.emit(tag);
            }
        }
    });

    // Check for updates (without blocking).
    Updater.checkForUpdates().then(updateAvailable => {
        if (updateAvailable) {
            Core.Events.once('toast-accept-update', () => Updater.applyUpdate());

            Core.View.toast = {
                type: 'info',
                message: 'A new update is available. You should update, it\'s probably really cool.',
                options: {
                    'toast-accept-update': 'Update Now',
                    'toast-dismiss': 'Maybe Later'
                }
            };
        }
    });
})();