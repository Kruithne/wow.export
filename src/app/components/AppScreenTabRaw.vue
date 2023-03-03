<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-raw">
		<div class="list-container">
			<list-box :selection="state.selectionRaw" :items="state.listfileRaw" :filter="state.userInputFilterRaw" :keyinput="true" :regex="state.config.regexFilters" :copymode="state.config.copyMode" :pasteselection="state.config.pasteSelection" :copytrimwhitespace="state.config.removePathSpacesCopy" :includefilecount="true" unittype="file"></list-box>
		</div>
		<div id="tab-raw-tray">
			<div class="filter">
				<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="state.userInputFilterRaw" placeholder="Filter raw files..."/>
			</div>
			<input type="button" value="Auto-Detect Selected" @click="click('detect-raw', $event)" :class="{ disabled: state.isBusy }"/>
			<input type="button" value="Export Selected" @click="click('export-raw', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
	</div>
</template>