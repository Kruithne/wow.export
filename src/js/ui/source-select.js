/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../core');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');
const ExternalLinks = require('../external-links');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');
const cdnResolver = require('../casc/cdn-resolver');
const { MPQInstall } = require('../mpq/mpq-install');

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
			core.view.setScreen('tab-home');
		} catch (e) {
			log.write('Failed to load CASC: %o', e);
			core.setToast('error', 'Unable to initialize CASC. Try repairing your game installation, or seek support.', {
				'View Log': () => log.openRuntimeLog(),
				'Visit Support Discord': () => ExternalLinks.open('::DISCORD')
			}, -1);
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
		let cdnURL = util.format(constants.PATCH.HOST, region.tag);
		if(region === 'cn')
			cdnURL = constants.PATCH.HOST_CHINA;

		const node = { tag: region.tag, name: region.name, url: cdnURL, delay: null };
		regions.push(node);

		// Mark this region as the selected one.
		if (region.tag === userRegion || (typeof userRegion !== 'string' && region.tag === constants.PATCH.DEFAULT_REGION)) {
			core.view.selectedCDNRegion = node;
			// Start pre-resolving CDN hosts for this region
			cdnResolver.startPreResolution(region.tag);
		}

		// Run a rudimentary ping check for each CDN.
		pings.push(generics.ping(cdnURL).then(ms => node.delay = ms).catch(e => {
			node.delay = -1;
			log.write('Failed ping to %s: %s', cdnURL, e.message);
		}).finally(() => {
			core.view.cdnRegions = [...regions]; // force reactivity
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

	// Grab recent legacy installations from config.
	let recentLegacy = core.view.config.recentLegacy;
	if (!Array.isArray(recentLegacy))
		recentLegacy = core.view.config.recentLegacy = [];

	const openInstall = async (installPath, product) => {
		core.hideToast();

		try {
			cascSource = new CASCLocal(installPath);
			await cascSource.init();

			if (product) {
				loadInstall(cascSource.builds.findIndex(build => build.Product === product));
			} else {
				core.view.availableLocalBuilds = cascSource.getProductList();
				core.view.setScreen('build-select');
			}
		} catch (e) {
			core.setToast('error', util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value), null, -1);
			log.write('Failed to initialize local CASC source: %s', e.message);

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
		selector.value = '';
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

				if (cascSource.builds.length === 0)
					throw new Error('No builds available.');

				core.view.availableRemoteBuilds = cascSource.getProductList();
				core.view.setScreen('build-select');
			} catch (e) {
				core.setToast('error', util.format('There was an error connecting to Blizzard\'s %s CDN, try another region!', tag.toUpperCase()), null, -1);
				log.write('Failed to initialize remote CASC source: %s', e.message);
			}
		});
	});

	// Register for 'click-source-build' events which are fired when the user selects
	// a build either for remote or local installations.
	core.events.on('click-source-build', loadInstall);

	// Register for 'click-return-to-source-select' event to return from build select screen
	core.events.on('click-return-to-source-select', () => {
		core.view.availableLocalBuilds = null;
		core.view.availableRemoteBuilds = null;
		core.view.setScreen('source-select');
	});

	// Set-up hooks for legacy installation dialog.
	const legacySelector = document.createElement('input');
	legacySelector.setAttribute('type', 'file');
	legacySelector.setAttribute('nwdirectory', true);
	legacySelector.setAttribute('nwdirectorydesc', 'Select Legacy MPQ Installation');

	const openLegacyInstall = async (installPath) => {
		core.hideToast();

		try {
			core.view.mpq = new MPQInstall(installPath);

			core.view.showLoadScreen('Loading Legacy Installation');
			core.view.isBusy++;

			const progress = core.createProgress(3);
			await core.view.mpq.loadInstall(progress);

			await progress.step('Initializing Components');
			await core.runLoadFuncs();

			const preIndex = core.view.config.recentLegacy.findIndex(e => e.path === installPath);
			if (preIndex > -1) {
				if (preIndex > 0)
					core.view.config.recentLegacy.unshift(core.view.config.recentLegacy.splice(preIndex, 1)[0]);
			} else {
				core.view.config.recentLegacy.unshift({ path: installPath });
			}

			if (core.view.config.recentLegacy.length > constants.MAX_RECENT_LOCAL)
				core.view.config.recentLegacy.splice(constants.MAX_RECENT_LOCAL, core.view.config.recentLegacy.length - constants.MAX_RECENT_LOCAL);

			core.view.isBusy--;
			core.view.setScreen('legacy-tab-home');
		} catch (e) {
			core.view.isBusy--;
			core.setToast('error', util.format('Failed to load legacy installation from %s', installPath), null, -1);
			log.write('Failed to initialize legacy MPQ source: %s', e.message);

			for (let i = core.view.config.recentLegacy.length - 1; i >= 0; i--) {
				if (core.view.config.recentLegacy[i].path === installPath)
					core.view.config.recentLegacy.splice(i, 1);
			}

			core.view.setScreen('source-select');
		}
	};

	core.events.on('click-source-legacy', () => {
		legacySelector.value = '';
		legacySelector.click();
	});

	legacySelector.onchange = () => openLegacyInstall(legacySelector.value);
	core.events.on('click-source-legacy-recent', entry => openLegacyInstall(entry.path));

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
			if (region.delay < selectedRegion.delay) {
				core.view.selectedCDNRegion = region;
				// Start pre-resolving CDN hosts for the new fastest region
				cdnResolver.startPreResolution(region.tag);
			}
		}
	});
});