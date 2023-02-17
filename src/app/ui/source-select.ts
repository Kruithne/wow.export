/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';

import Constants from '../constants';
import Log from '../log';
import ExternalLinks from '../external-links';
import State from '../state';
import Events from '../events';

import { ping } from '../generics';
import { reactive } from 'vue';

import CASC from '../casc/casc-source';
import CASCLocal from '../casc/casc-source-local';
import CASCRemote from '../casc/casc-source-remote';

export type CDNRegion = { tag: string, url: string, delay: number | null };

let cascSource: CASC;

function loadInstall(index: number): void {
	State.state.block(async () => {
		State.state.showLoadScreen();

		// Wipe the available build lists.
		State.state.availableLocalBuilds = null;
		State.state.availableRemoteBuilds = null;

		if (cascSource instanceof CASCLocal) {
			// Update the recent local installation list..
			const recentLocal = State.state.config.recentLocal;
			const installPath = cascSource.dir;
			const build = cascSource.builds[index];
			const preIndex = recentLocal.findIndex(e => e.path === installPath && e.product === build.Product);
			if (preIndex > -1) {
				// Already in the list, bring it to the top (if not already).
				if (preIndex > 0)
					recentLocal.unshift(recentLocal.splice(preIndex, 1)[0]);
			} else {
				// Not in the list, add it to the top.
				recentLocal.unshift({ path: installPath, product: build.Product });
			}

			// Limit amount of entries allowed in the recent list.
			if (recentLocal.length > Constants.MAX_RECENT_LOCAL)
				recentLocal.splice(Constants.MAX_RECENT_LOCAL, recentLocal.length - Constants.MAX_RECENT_LOCAL);
		}

		try {
			await cascSource.load(index);
			State.state.setScreen('tab-models');
		} catch (e) {
			Log.write('Failed to load CASC: %o', e);
			State.state.setToast('error', 'Unable to initialize CASC. Try repairing your game installation, or seek support.', {
				'View Log': () => Log.openRuntimeLog(),
				'Visit Support Discord': () => ExternalLinks.openExternalLink('::DISCORD')
			}, -1);
			State.state.setScreen('source-select');
		}
	});
}

Events.once('state-ready', (): void => {
	Events.once('screen-source-select', async () => {
		const pings = Array<Promise<number | void>>();
		const regions = State.state.cdnRegions;
		const userRegion = State.state.config.sourceSelectUserRegion;

		// User has pre-selected a CDN, lock choice from changing.
		if (typeof userRegion === 'string')
			State.state.lockCDNRegion = true;

		// Iterate CDN regions and create data nodes.
		for (const region of Constants.PATCH.REGIONS) {
			const cdnURL: string = util.format(Constants.PATCH.HOST, region);
			const node: CDNRegion = reactive({ tag: region, url: cdnURL, delay: null });
			regions.push(node);

			// Mark this region as the selected one.
			if (region === userRegion || (typeof userRegion !== 'string' && region === Constants.PATCH.DEFAULT_REGION))
				State.state.selectedCDNRegion = node;

			// Run a rudimentary ping check for each CDN.
			pings.push(ping(cdnURL).then(ms => node.delay = ms).catch(e => {
				node.delay = -1;
				Log.write('Failed ping to %s: %s', cdnURL, e.message);
			}));
		}

		// Set-up hooks for local installation dialog.
		const selector = document.createElement('input');
		selector.setAttribute('type', 'file');
		selector.setAttribute('nwdirectory', 'true');
		selector.setAttribute('nwdirectorydesc', 'Select World of Warcraft Installation');

		// Grab recent local installations from config.
		let recentLocal = State.state.config.recentLocal;
		if (!Array.isArray(recentLocal))
			recentLocal = State.state.config.recentLocal = [];

		async function openInstall(installPath: string, product: string | undefined = undefined): Promise<void> {
			State.state.hideToast();

			try {
				cascSource = new CASCLocal(installPath);
				await cascSource.init();

				if (product)
					loadInstall(cascSource.builds.findIndex(build => build.Product === product));
				else
					State.state.availableLocalBuilds = cascSource.getProductList();
			} catch (e) {
				State.state.setToast('error', util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value), null, -1);
				Log.write('Failed to initialize local CASC source: %s', e.message);

				// In the event the given installation directory is now invalid, remove all
				// recent local entries using that directory. If product was provided, we can
				// filter more specifically for that broken build.
				for (let i = recentLocal.length - 1; i >= 0; i--) {
					const entry = recentLocal[i];
					if (entry.path === installPath && (!product || entry.product === product))
						recentLocal.splice(i, 1);
				}
			}
		}

		// Register for the 'click-source-local' event fired when the user clicks 'Open Local Installation'.
		// Prompt the user with a directory selection dialog to locate their local installation.
		Events.on('click-source-local', () => {
			selector.value = ''; // Wipe the existing value to ensure onchange triggers.
			selector.click();
		});

		// Both selecting a file using the directory selector, and clicking on a recent local
		// installation (click-source-local-recent) should then attempt to open an install.
		selector.onchange = (): Promise<void> => openInstall(selector.value);
		Events.on('click-source-local-recent', entry => openInstall(entry.path, entry.product));

		// Register for the 'click-source-remote' event fired when the user clicks 'Use Blizzard CDN'.
		// Attempt to initialize a remote CASC source using the selected region.
		Events.on('click-source-remote', () => {
			State.state.block(async () => {
				const tag = State.state.selectedCDNRegion.tag;

				try {
					cascSource = new CASCRemote(tag);
					await cascSource.init();

					// No builds available, likely CDN is not available.
					if (cascSource.builds.length === 0)
						throw new Error('No builds available.');

					State.state.availableRemoteBuilds = cascSource.getProductList();
				} catch (e) {
					State.state.setToast('error', util.format('There was an error connecting to Blizzard\'s %s CDN, try another region!', tag.toUpperCase()), null, -1);
					Log.write('Failed to initialize remote CASC source: %s', e.message);
				}
			});
		});

		// Register for 'click-source-build' events which are fired when the user selects
		// a build either for remote or local installations.
		Events.on('click-source-build', loadInstall);

		// Once all pings are resolved, pick the fastest.
		Promise.all(pings).then(() => {
			// CDN region choice is locked, do nothing.
			if (State.state.lockCDNRegion)
				return;

			const selectedRegion = State.state.selectedCDNRegion;
			for (const region of regions) {
				// Skip regions that don't have a valid ping.
				if (region.delay === null || region.delay < 0)
					continue;

				// Switch the selected region for the fastest one.
				if (region.delay < selectedRegion.delay)
					State.state.selectedCDNRegion = region;
			}
		});
	});
});