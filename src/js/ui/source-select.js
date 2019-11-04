const util = require('util');
const core = require('../core');
const config = require('../config');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');

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