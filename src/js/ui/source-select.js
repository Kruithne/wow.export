const util = require('util');
const core = require('../core');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');

let cascSource = null;

const loadInstall = (index) => {
	core.block(async () => {
		core.view.showLoadScreen();

		// Wipe the available build lists.
		core.view.availableLocalBuilds = null;
		core.view.availableRemoteBuilds = null;

		if (cascSource instanceof CASCLocal) {
			// Update the recent local installation list..
			const recentLocal = core.view.config.recentLocal;
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
			if (recentLocal.length > constants.MAX_RECENT_LOCAL)
				recentLocal.splice(constants.MAX_RECENT_LOCAL, recentLocal.length - constants.MAX_RECENT_LOCAL);
		}

		try {
			await cascSource.load(index);

			// Passing the CASC instance to Vue causes the entire instance (with indexes) to
			// become observable. This is a massive waste of memory. We freeze the instance here
			// to prevent that from happening.
			Object.freeze(cascSource);

			core.view.casc = cascSource;
			core.view.setScreen('tab-models');
		} catch (e) {
			log.write('Failed to load CASC: %o', e);
			core.setToast('error', 'Unable to initialize CASC. If this persists, seek assistance!', {
				'View Log': () => log.openRuntimeLog()
			});
			core.view.setScreen('source-select');
		}
	});
};

core.events.once('screen-source-select', async () => {
	const pings = [];
	const regions = core.view.cdnRegions;
	const userRegion = core.view.config.sourceSelectUserRegion;

	// User has pre-selected a CDN, lock choice from changing.
	if (typeof userRegion === 'string')
		core.view.lockCDNRegion = true;

	// Iterate CDN regions and create data nodes.
	for (const region of constants.PATCH.REGIONS) {
		const cdnURL = util.format(constants.PATCH.HOST, region);
		const node = { tag: region, url: cdnURL, delay: null };
		regions.push(node);

		// Mark this region as the selected one.
		if (region === userRegion || (typeof userRegion !== 'string' && region === constants.PATCH.DEFAULT_REGION))
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
	let recentLocal = core.view.config.recentLocal;
	if (!Array.isArray(recentLocal))
		recentLocal = core.view.config.recentLocal = [];

	const openInstall = async (installPath, product) => {
		try {
			cascSource = new CASCLocal(installPath);
			await cascSource.init();

			if (product)
				loadInstall(cascSource.builds.findIndex(build => build.Product === product));
			else
				core.view.availableLocalBuilds = cascSource.getProductList();
		} catch (e) {
			core.setToast('error', util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value));
			log.write('Failed to initialize local CASC source: %s', e.message);

			// In the event the given installation directory is now invalid, remove all
			// recent local entries using that directory. If product was provided, we can
			// filter more specifically for that broken build.
			for (let i = recentLocal.length - 1; i >= 0; i--) {
				const entry = recentLocal[i];
				if (entry.path === installPath && (!product || entry.product === product))
					recentLocal.splice(i, 1);
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
	core.events.on('click-source-local-recent', entry => openInstall(entry.path, entry.product));

	// Register for the 'click-source-remote' event fired when the user clicks 'Use Blizzard CDN'.
	// Attempt to initialize a remote CASC source using the selected region.
	core.events.on('click-source-remote', () => {
		core.block(async () => {
			const tag = core.view.selectedCDNRegion.tag;

			try {
				cascSource = new CASCRemote(tag);
				await cascSource.init();

				// No builds available, likely CDN is not available.
				if (cascSource.builds.length === 0)
					throw new Error('No builds available.');
				
				core.view.availableRemoteBuilds = cascSource.getProductList();
			} catch (e) {
				core.setToast('error', util.format('There was an error connecting to Blizzard\'s %s CDN, try another region!', tag.toUpperCase()));
				log.write('Failed to initialize remote CASC source: %s', e.message);
			}
		});
	});

	// Register for 'click-source-build' events which are fired when the user selects
	// a build either for remote or local installations.
	core.events.on('click-source-build', loadInstall);

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