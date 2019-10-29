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
    const content = new Vue({
        el: '#container',
        data: {
            isSourceActive: false,
            localSourceRecent: []
        }
    });
})();