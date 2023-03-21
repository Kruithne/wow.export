<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, setScreen, setToast } from '../core';

	import util from 'node:util';

	import Constants from '../constants';
	import Log from '../log';
	import ExternalLinks from '../external-links';

	import CASC from '../casc/casc-source';
	import CASCLocal from '../casc/casc-source-local';
	import CASCRemote from '../casc/casc-source-remote';

	let cascSource: CASC;

	// TODO: This is a duplicate from global.d.ts - need to find a way to share this type.
	type CDNRegion = { tag: string, url: string, delay: number | null };

	// Set-up hooks for local installation dialog.
	const selector = document.createElement('input');
	selector.setAttribute('type', 'file');
	selector.setAttribute('nwdirectory', 'true');
	selector.setAttribute('nwdirectorydesc', 'Select World of Warcraft Installation');
	selector.onchange = (): Promise<void> => initLocalInstall(selector.value);

	function getProductTag(product: string): string {
		const entry = Constants.PRODUCTS.find(e => e.product === product);
		return entry ? entry.tag : 'Unknown';
	}

	function openFolderSelector(): void {
		selector.value = ''; // Wipe the existing value to ensure onchange triggers.
		selector.click();
	}

	function setSelectedCDN(region: CDNRegion): void {
		state.selectedCDNRegion = region;
		state.config.sourceSelectUserRegion = region.tag;
		state.lockCDNRegion = true;
	}

	async function loadInstall(index: number): Promise<void> {
		state.isBusy++;
		state.showLoadScreen();

		// Wipe the available build lists.
		state.availableLocalBuilds = null;
		state.availableRemoteBuilds = null;

		if (cascSource instanceof CASCLocal) {
			// Update the recent local installation list..
			const recentLocal = state.config.recentLocal;
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

			setScreen('tab-models');
		} catch (e) {
			Log.write('Failed to load CASC: %o', e);
			setToast('error', 'Unable to initialize CASC. Try repairing your game installation, or seek support.', {
				'View Log': () => Log.openRuntimeLog(),
				'Visit Support Discord': () => ExternalLinks.openExternalLink('::DISCORD')
			}, -1);
			setScreen('source-select');
		} finally {
			state.isBusy--;
		}
	}

	async function initLocalInstall(installPath: string, product: string | undefined = undefined): Promise<void> {
		state.hideToast();

		try {
			cascSource = new CASCLocal(installPath);
			await cascSource.init();

			if (product)
				loadInstall(cascSource.builds.findIndex(build => build.Product === product));
			else
				state.availableLocalBuilds = cascSource.getProductList();
		} catch (e) {
			setToast('error', util.format('It looks like %s is not a valid World of Warcraft installation.', selector.value), null, -1);
			Log.write('Failed to initialize local CASC source: %s', e.message);

			// In the event the given installation directory is now invalid, remove all
			// recent local entries using that directory. If product was provided, we can
			// filter more specifically for that broken build.
			for (let i = state.config.recentLocal.length - 1; i >= 0; i--) {
				const entry = state.config.recentLocal[i];
				if (entry.path === installPath && (!product || entry.product === product))
					state.config.recentLocal.splice(i, 1);
			}
		}
	}

	async function initRemoteInstall(): Promise<void> {
		state.isBusy++;

		try {
			cascSource = new CASCRemote(state.selectedCDNRegion.tag);
			await cascSource.init();

			// No builds available, likely CDN is not available.
			if (cascSource.builds.length === 0)
				throw new Error('No builds available.');

			state.availableRemoteBuilds = cascSource.getProductList();
		} catch (e) {
			setToast('error', util.format('There was an error connecting to Blizzard\'s %s CDN, try another region!', state.selectedCDNRegion.tag.toUpperCase()), null, -1);
			Log.write('Failed to initialize remote CASC source: %s', e.message);
		} finally {
			state.isBusy--;
		}
	}
</script>

<template>
	<div id="source-select">
		<div id="source-local" :class="{ disabled: !!state.availableLocalBuilds }" @click="openFolderSelector">
			<template v-if="state.availableLocalBuilds">
				<div class="source-builds">
					<span>Select Build</span>
					<input v-for="(build, i) in state.availableLocalBuilds" @click.stop="loadInstall(i)" :class="{ disabled: state.isBusy }" type="button" :value="build"/>
					<span @click.stop="state.availableLocalBuilds = null" class="link">Cancel</span>
				</div>
			</template>
			<template v-else>
				<div class="source-icon"></div>
				<div class="source-text">
					Open Local Installation
					<span>(Recommended)</span>
					<ul id="source-recent" v-if="state.config.recentLocal && state.config.recentLocal.length > 0">
						<li>Recent</li>
						<li v-for="entry in state.config.recentLocal" class="link" @click.stop="initLocalInstall(entry.path, entry.product)">{{ entry.path }} ({{ getProductTag(entry.product) }})</li>
					</ul>
				</div>
			</template>
		</div>
		<div id="source-remote" :class="{ disabled: !!state.availableRemoteBuilds }" @click="initRemoteInstall">
			<template v-if="state.availableRemoteBuilds">
				<div class="source-builds">
					<span>Select Build</span>
					<input v-for="(build, i) in state.availableRemoteBuilds" @click.stop="loadInstall(i)" :class="{ disabled: state.isBusy }" type="button" :value="build"/>
					<span @click.stop="state.availableRemoteBuilds = null" class="link">Cancel</span>
				</div>
			</template>
			<template v-else>
				<div class="source-icon"></div>
				<div class="source-text">
					Use Blizzard CDN
					<ul id="source-cdn" class="ui-multi-button">
						<li v-for="region in state.cdnRegions" :class="{ selected: state.selectedCDNRegion === region }" @click.stop="setSelectedCDN(region)">
							{{ region.tag.toUpperCase() }}
							<span v-if="region.delay !== null">{{ region.delay < 0 ? 'N/A' : region.delay + 'ms' }}</span>
						</li>
					</ul>
				</div>
			</template>
		</div>
	</div>
</template>