<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-video">
		<div class="list-container">
			<list-box
				:selection="state.selectionVideos"
				:items="state.listfileVideos"
				:filter="state.userInputFilterVideos"
				:keyinput="true"
				:regex="state.config.regexFilters"
				:copymode="state.config.copyMode"
				:pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy"
				:includefilecount="true" unittype="video">
			</list-box>
		</div>
		<div id="tab-video-tray">
			<div class="filter">
				<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="state.userInputFilterVideos" placeholder="Filter videos..."/>
			</div>
			<input type="button" value="Export Selected" @click="click('export-video', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
	</div>
</template>