<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click, getProductTag, setSelectedCDN } from '../core';
</script>

<template>
	<div id="source-select">
		<div id="source-local" :class="{ disabled: !!state.availableLocalBuilds }" @click="click('source-local', $event)">
			<template v-if="state.availableLocalBuilds">
				<div class="source-builds">
					<span>Select Build</span>
					<input v-for="(build, i) in state.availableLocalBuilds" @click.stop="click('source-build', $event, i)" :class="{ disabled: state.isBusy }" type="button" :value="build"/>
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
						<li v-for="entry in state.config.recentLocal" class="link" @click.stop="click('source-local-recent', $event, entry)">{{ entry.path }} ({{ getProductTag(entry.product) }})</li>
					</ul>
				</div>
			</template>
		</div>
		<div id="source-remote" :class="{ disabled: !!state.availableRemoteBuilds }" @click="click('source-remote', $event)">
			<template v-if="state.availableRemoteBuilds">
				<div class="source-builds">
					<span>Select Build</span>
					<input v-for="(build, i) in state.availableRemoteBuilds" @click.stop="click('source-build', $event, i)" :class="{ disabled: state.isBusy }" type="button" :value="build"/>
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