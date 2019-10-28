(async () => {
    // Wait for the DOM to be loaded.
    if (document.readyState === 'loading')
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));

    // Append the application version to the title bar.
    document.title += ' v' + nw.App.manifest.version;
})();