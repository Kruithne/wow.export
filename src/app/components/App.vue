<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
	import AppToast from './AppToast.vue';
	import AppNavigation from './AppNavigation.vue';

	import AppScreenLoading from './AppScreenLoading.vue';
	import AppScreenChangeLog from './AppScreenChangeLog.vue';
	import AppScreenBlender from './AppScreenBlender.vue';
	import AppScreenConfig from './AppScreenConfig.vue';
	import AppScreenSourceSelect from './AppScreenSourceSelect.vue';

	import AppScreenTabTextures from './AppScreenTabTextures.vue';
	import AppScreenTabData from './AppScreenTabData.vue';
	import AppScreenTabInstall from './AppScreenTabInstall.vue';
	import AppScreenTabModels from './AppScreenTabModels.vue';
	import AppScreenTabItems from './AppScreenTabItems.vue';
	import AppScreenTabMaps from './AppScreenTabMaps.vue';
	import AppScreenTabRaw from './AppScreenTabRaw.vue';
	import AppScreenTabSounds from './AppScreenTabSounds.vue';
	import AppScreenTabVideo from './AppScreenTabVideo.vue';
	import AppScreenTabText from './AppScreenTabText.vue';
</script>

<template>
	<div id="header" :class="{ shadowed: state.toast !== null }">
		<div id="logo">wow.export</div>
		<AppNavigation/>
	</div>
	<div id="content">
		<AppScreenLoading v-if="state.screen === 'loading'"/>
		<AppScreenChangeLog v-else-if="state.screen === 'changelog'"/>
		<AppScreenBlender v-else-if="state.screen === 'blender'"/>
		<AppScreenConfig v-else-if="state.screen === 'config'"/>
		<AppScreenSourceSelect v-else-if="state.screen === 'source-select'"/>

		<AppToast /> <!-- TODO: Replace with a better system. -->

		<keep-alive><AppScreenTabTextures v-if="state.screen === 'tab-textures'"/></keep-alive>
		<keep-alive><AppScreenTabData v-if="state.screen === 'tab-data'"/></keep-alive>
		<keep-alive><AppScreenTabInstall v-if="state.screen === 'tab-install'"/></keep-alive>
		<keep-alive><AppScreenTabModels v-if="state.screen === 'tab-models'"/></keep-alive>
		<keep-alive><AppScreenTabItems v-if="state.screen === 'tab-items'"/></keep-alive>
		<keep-alive><AppScreenTabMaps v-if="state.screen === 'tab-maps'"/></keep-alive>
		<keep-alive><AppScreenTabRaw v-if="state.screen === 'tab-raw'"/></keep-alive>
		<keep-alive><AppScreenTabSounds v-if="state.screen === 'tab-sounds'"/></keep-alive>
		<keep-alive><AppScreenTabVideo v-if="state.screen === 'tab-video'"/></keep-alive>
		<keep-alive><AppScreenTabText v-if="state.screen === 'tab-text'"/></keep-alive>
	</div>
	<div id="footer">
		<template v-if="state.screen === 'config'">
			<div id="config-buttons">
				<input type="button" value="Discard" :class="{ disabled: state.isBusy }" @click="click('config-discard', $event)"/>
				<input type="button" value="Apply" :class="{ disabled: state.isBusy }" @click="click('config-apply', $event)"/>
				<input type="button" id="config-reset" value="Reset to Defaults" :class="{ disabled: state.isBusy }" @click="click('config-reset', $event)"/>
			</div>
		</template>
		<template v-else>
			<span id="footer-links">
				<a data-external="::WEBSITE">Website</a> - <a data-external="::DISCORD">Discord</a> - <a data-external="::PATREON">Patreon</a> - <a data-external="::GITHUB">GitHub</a>
			</span>
			<span id="footer-copyright">
				World of Warcraft and related trademarks are registered trademarks of Blizzard Entertainment whom this application is not affiliated with.
			</span>
		</template>
	</div>
</template>