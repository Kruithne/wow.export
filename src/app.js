// Prevent files from being dropped onto the window.
// ToDo: Expand this to allow local conversion invokes via file drop?
window.ondragover = e => { e.preventDefault(); return false; };
window.ondrop = e => { e.preventDefault(); return false; };

(async () => {
    // Wait for the DOM to be loaded.
    if (document.readyState === 'loading')
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

    // Append the application version to the title bar.
    document.title += ' v' + nw.App.manifest.version;
})();