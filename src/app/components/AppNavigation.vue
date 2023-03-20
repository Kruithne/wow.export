<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, setScreen } from '../core';
	import { openRuntimeLog } from '../log';
	import { restartApplication } from '../system';

	function reloadStylesheets(): void {
		const sheets = document.querySelectorAll('link[rel="stylesheet"]');
		for (const sheet of sheets)
			(sheet as HTMLLinkElement).href = sheet.getAttribute('data-href') + '?v=' + Date.now();
	}
</script>

<template>
	<div id="nav">
		<template v-if="!!state.screen && state.screen.startsWith('tab-')">
			<div class="option" id="nav-models" @click="setScreen('tab-models')" :class="{ active: state.screen === 'tab-models' }">Models</div>
			<div class="option" id="nav-items" @click="setScreen('tab-items')" :class="{ active: state.screen === 'tab-items' }">Items</div>
			<div class="option" id="nav-textures" @click="setScreen('tab-textures')" :class="{ active: state.screen === 'tab-textures' }">Textures</div>
			<div class="option" id="nav-sounds" @click="setScreen('tab-sounds')" :class="{ active: state.screen === 'tab-sounds' }">Audio</div>
			<div class="option" id="nav-videos" @click="setScreen('tab-video')" :class="{ active: state.screen === 'tab-video' }">Videos</div>
			<div class="option" id="nav-maps" @click="setScreen('tab-maps')" :class="{ active: state.screen === 'tab-maps' }">Maps</div>
			<div class="option" id="nav-text" @click="setScreen('tab-text')" :class="{ active: state.screen === 'tab-text' }">Text</div>
			<!--<div class="option" id="nav-data" @click="setScreen('tab-data')" :class="{ active: screen === 'tab-data' }">Data</div>-->
		</template>
		<div id="nav-extra" v-if="!state.isBusy" @click="state.contextMenus.stateNavExtra = true"></div>
		<context-menu @close="state.contextMenus.stateNavExtra = false" :node="state.contextMenus.stateNavExtra" id="menu-extra">
			<span @click.self="setScreen('blender', true)" id="menu-extra-blender">Install Blender Add-on</span>
			<span @click.self="setScreen('changelog', true)" id="menu-extra-changes">View Recent Changes</span>
			<span @click.self="openRuntimeLog" id="menu-extra-log">Open Runtime Log</span>
			<span v-if="state.casc !== null" @click.self="setScreen('tab-raw')" id="menu-extra-raw">Browse Raw Client Files</span>
			<span v-if="state.casc !== null" @click.self="setScreen('tab-install')" id="menu-extra-install">Browse Install Manifest</span>
			<span @click.self="setScreen('config', true)" id="menu-extra-settings">Manage Settings</span>
			<span @click.self="restartApplication" id="menu-extra-restart">Restart wow.export</span>
			<span v-if="state.isDebugBuild" @click.self="reloadStylesheets" id="menu-extra-style">Reload Styling</span>
		</context-menu>
	</div>
</template>