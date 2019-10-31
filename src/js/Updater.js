const util = require('util');
const path = require('path');
const assert = require('assert').strict;
const fsp = require('fs').promises;
const cp = require('child_process');
const Constants = require('./Constants');
const Utils = require('./Utils');
const Core = require('./Core');

let updateManifest;

/**
 * Check if there are any available updates.
 * Returns a Promise that resolves to true if an update is available.
 */
const checkForUpdates = async () => {
    try {
        const localManifest = nw.App.manifest;
        const manifestURL = util.format(Constants.Update.URL, localManifest.flavour) + Constants.Update.Manifest;
        const manifest = await Utils.getJSON(manifestURL);

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
    Core.View.isBusy = true;
    Core.View.isUpdating = true;

    const requiredFiles = [];

    // Check required files and calculate total file size...
    let totalSize = 0;
    const entries = Object.entries(updateManifest.contents);
    for (let i = 0; i < entries.length; i++) {
        const [file, meta] = entries[i];
        const [hash, size] = meta;

        Core.View.updateProgress = util.format('Verifying local files (%d / %d)', i + 1, entries.length);
        totalSize += size;

        const localPath = path.join(Constants.InstallPath, file);
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
            const localHash = await Utils.getFileHash(localPath, 'sha256', 'hex');
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

    const remoteDir = util.format(Constants.Update.URL, nw.App.manifest.flavour);

    let downloadSize = 0;
    for (const node of requiredFiles) {
        Core.View.updateProgress = util.format('%s / %s (%s%)', Utils.filesize(downloadSize), Utils.filesize(totalSize), Math.floor((downloadSize / totalSize) * 100));
        await Utils.downloadFile(remoteDir + node.file, path.join(Constants.Update.Directory, node.file));
        downloadSize += node.size;
    }

    Core.View.updateProgress = 'Restarting application';
    await launchUpdater();
};

/**
 * Launch the external updater process and exit.
 */
const launchUpdater = async () => {
    // On the rare occurance that we've updated the updater, the updater
    // cannot update the updater, so instead we update the updater here.
    const helperApp = path.join(Constants.Installpath, Constants.Update.Helper);
    const updatedApp = path.join(Constants.Update.Directory, Constants.Update.Helper);

    try {
        // Rather than checking if an updated updater exists, just attempt
        // to copy it regardless. It will fail if not or on permission errors.
        await fsp.copyFile(updatedApp, helperApp);
    } catch (e) {}

    // Launch the updater application.
    const child = cp.spawn(helperApp, [], { detached: true, stdio: 'ignore' });
    child.unref();
    process.exit();
};

module.exports = { checkForUpdates, applyUpdate };