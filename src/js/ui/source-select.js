const util = require('util');
const core = require('../core');
const config = require('../config');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');

core.events.once('screen-source-select', async () => {
    // GH-4: Load most recent local installation paths into local source select widget.

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

    // Monitor the directory selector for changes and then attempt to initialize
    // a local CASC source using the selected directory.
    selector.onchange = async () => {
        try {
            const source = new CASCLocal(selector.value);
            await source.init();

            core.view.availableLocalBuilds = source.getProductList();
        } catch (e) {
            core.view.toast = { type: 'error', message: util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value) };
            log.write('Failed to initialize local CASC source: %s', e.message);
        }
    };

    // Register for the 'click-source-local' event fired when the user clicks 'Open Local Installation'.
    // Prompt the user with a directory selection dialog to locate their local installation.
    core.events.on('click-source-local', () => selector.click());

    // Register for the 'click-source-remote' event fired when the user clicks 'Use Blizzard CDN'.
    // Attempt to initialize a remote CASC source using the selected region.
    core.events.on('click-source-remote', async () => {
        try {
            const source = new CASCRemote(core.view.selectedCDNRegion.tag);
            await source.init();
            
            core.view.availableRemoteBuilds = source.getProductList();
        } catch (e) {
            log.write('Failed to initialize remote CASC source: %s', e.message);
        }
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