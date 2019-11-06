const util = require('util');
const core = require('../core');
const config = require('../config');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');

let cascSource = null;

core.events.once('screen-source-select', async () => {
    const pings = [];
    const regions = core.view.cdnRegions;
    const userRegion = config.getString('sourceSelectUserRegion');

    // User has pre-selected a CDN, lock choice from changing.
    if (userRegion !== null)
        core.view.lockCDNRegion = true;

    // Iterate CDN regions and create data nodes.
    for (const region of constants.PATCH.REGIONS) {
        const cdnURL = util.format(constants.PATCH.HOST, region);
        const node = { tag: region, url: cdnURL, delay: null };
        regions.push(node);

        // Mark this region as the selected one.
        if (region === userRegion || (userRegion === null && region === constants.PATCH.DEFAULT_REGION))
            core.view.selectedCDNRegion = node;

        // Run a rudimentary ping check for each CDN. 
        pings.push(generics.ping(cdnURL).then(ms => node.delay = ms).catch(e => {
            node.delay = -1;
            log.write('Failed ping to %s: %s', cdnURL, e.message);
        }));
    }

    // Set-up hooks for local installation dialog.
    const selector = document.createElement('input');
    selector.setAttribute('type', 'file');
    selector.setAttribute('nwdirectory', true);
    selector.setAttribute('nwdirectorydesc', 'Select World of Warcraft Installation');

    // Grab recent local installations from config.
    const recentLocal = config.getArray('recentLocal');

    const openInstall = async (installPath) => {
        try {
            cascSource = new CASCLocal(installPath);
            await cascSource.init();

            core.view.availableLocalBuilds = cascSource.getProductList();

            // Update the recent local installation list..
            const preIndex = recentLocal.indexOf(installPath);
            if (preIndex > -1) {
                // Already in the list, bring it to the top (if not already).
                if (preIndex > 0)
                    recentLocal.unshift(recentLocal.splice(preIndex, 1)[0]);
            } else {
                // Not in the list, add it to the top.
                recentLocal.unshift(installPath);
            }

            // Limit amount of entries allowed in the recent list.
            if (recentLocal.length > constants.MAX_RECENT_LOCAL)
                recentLocal.splice(constants.MAX_RECENT_LOCAL, recentLocal.length - constants.MAX_RECENT_LOCAL);

            config.save(); // Changes to arrays are not automatically detected.
        } catch (e) {
            core.view.toast = { type: 'error', message: util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value) };
            log.write('Failed to initialize local CASC source: %s', e.message);

            // In the event that the given directory was once a valid installation and
            // is listed in the recent local list, make sure it is removed now.
            const index = recentLocal.indexOf(installPath);
            if (index > -1) {
                recentLocal.splice(index, 1);
                config.save();
            }
        }
    };

    // Register for the 'click-source-local' event fired when the user clicks 'Open Local Installation'.
    // Prompt the user with a directory selection dialog to locate their local installation.
    core.events.on('click-source-local', () => {
        selector.value = ''; // Wipe the existing value to ensure onchange triggers.
        selector.click();
    });

    // Both selecting a file using the directory selector, and clicking on a recent local
    // installation (click-source-local-recent) should then attempt to open an install.
    selector.onchange = () => openInstall(selector.value);
    core.events.on('click-source-local-recent', entry => openInstall(entry));

    // Register for the 'click-source-remote' event fired when the user clicks 'Use Blizzard CDN'.
    // Attempt to initialize a remote CASC source using the selected region.
    core.events.on('click-source-remote', () => {
        core.block(async () => {
            try {
                cascSource = new CASCRemote(core.view.selectedCDNRegion.tag);
                await cascSource.init();
                
                core.view.availableRemoteBuilds = cascSource.getProductList();
            } catch (e) {
                log.write('Failed to initialize remote CASC source: %s', e.message);
            }
        });
    });

    // Register for 'click-source-build' events which are fired when the user selects
    // a build either for remote or local installations.
    core.events.on('click-source-build', (index) => {
        core.block(async () => {
            core.showLoadScreen();
            core.setLoadProgress('Not actually doing anything right now!', 0.5);
        });

        // ToDo: Invoke cascSource.load(); and await it's return.
        // ToDo: If there are any errors during casc load, revert back to source-select.

        //core.setScreen('tab-models');
    });

    // Once all pings are resolved, pick the fastest.
    Promise.all(pings).then(() => {
        // CDN region choice is locked, do nothing.
        if (core.view.lockCDNRegion)
            return;

        let selectedRegion = core.view.selectedCDNRegion;
        for (const region of regions) {
            // Skip regions that don't have a valid ping.
            if (region.delay === null || region.delay < 0)
                continue;

            // Switch the selected region for the fastest one.
            if (region.delay < selectedRegion.delay)
                core.view.selectedCDNRegion = region;
        }
    });
});