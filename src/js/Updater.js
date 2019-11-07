const util = require('util');
const path = require('path');
const assert = require('assert').strict;
const fsp = require('fs').promises;
const cp = require('child_process');
const constants = require('./constants');
const generics = require('./generics');
const core = require('./core');

let updateManifest;

/**
 * Check if there are any available updates.
 * Returns a Promise that resolves to true if an update is available.
 */
const checkForUpdates = async () => {
    try {
        const localManifest = nw.App.manifest;
        const manifestURL = util.format(constants.UPDATE.URL, localManifest.flavour) + constants.UPDATE.MANIFEST;
        const manifest = await generics.getJSON(manifestURL);

        assert(typeof manifest.guid === 'string', 'Update manifest does not contain a valid build GUID');
        assert(typeof manifest.contents === 'object', 'Update manifest does not contain a valid contents list');

        if (manifest.guid !== localManifest.guid) {
            updateManifest = manifest;
            return true;
        }

        return false;
    } catch (e) {
        console.log(e);
        return false;
    }
};

/**
 * Apply an outstanding update.
 */
const applyUpdate = async () => {
    core.block(async () => {
        core.showLoadScreen('Updating, please wait...');

        const requiredFiles = [];

        // Check required files and calculate total file size...
        let totalSize = 0;
        const entries = Object.entries(updateManifest.contents);
        for (let i = 0; i < entries.length; i++) {
            const [file, meta] = entries[i];
            const [hash, size] = meta;

            await core.setLoadProgress(util.format('Verifying local files (%d / %d)', i + 1, entries.length), (i + 1) / entries.length);
            totalSize += size;

            const localPath = path.join(constants.INSTALL_PATH, file);
            const node = { file, size };

            try {
                const stats = await fsp.stat(localPath);

                // If the file size is different, skip hashing and just mark for update.
                if (stats.size !== size) {
                    console.log('%d !== %d', stats.size, size);
                    requiredFiles.push(node);
                    continue;
                }

                // Verify local sha256 hash with remote one.
                const localHash = await generics.getFileHash(localPath, 'sha256', 'hex');
                if (localHash !== hash) {
                    console.log('%s !== %s', localHash, hash);
                    requiredFiles.push(node);
                    continue;
                }
            } catch (e) {
                // Error thrown, likely due to file not existing.
                requiredFiles.push(node);
            }
        }

        const remoteDir = util.format(constants.UPDATE.URL, nw.App.manifest.flavour);

        let downloadSize = 0;
        for (const node of requiredFiles) {
            const pct = (downloadSize / totalSize);
            await core.setLoadProgress(util.format('%s / %s (%s%)', generics.filesize(downloadSize), generics.filesize(totalSize), Math.floor(pct * 100)), pct);
            await generics.downloadFile(remoteDir + node.file, path.join(constants.UPDATE.DIRECTORY, node.file));
            downloadSize += node.size;
        }

        core.view.loadingProgress = 'Restarting application';
        await launchUpdater();
    });
};

/**
 * Launch the external updater process and exit.
 */
const launchUpdater = async () => {
    // On the rare occurance that we've updated the updater, the updater
    // cannot update the updater, so instead we update the updater here.
    const helperApp = path.join(constants.Installpath, constants.UPDATE.HELPER);
    const updatedApp = path.join(constants.UPDATE.DIRECTORY, constants.UPDATE.HELPER);

    try {
        // Rather than checking if an updated updater exists, just attempt
        // to copy it regardless. It will fail if not or on permission errors.
        await fsp.copyFile(updatedApp, helperApp);
    } catch (e) {}

    // Launch the updater application.
    const child = cp.spawn(helperApp, [process.pid], { detached: true, stdio: 'ignore' });
    child.unref();
    process.exit();
};

module.exports = { checkForUpdates, applyUpdate };