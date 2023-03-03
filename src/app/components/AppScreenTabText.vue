<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-text">
		<div class="list-container">
			<list-box
				:selection="state.selectionText"
				:items="state.listfileText"
				:filter="state.userInputFilterText"
				:keyinput="true"
				:regex="state.config.regexFilters"
				:copymode="state.config.copyMode"
				:pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy"
				:includefilecount="true"
				unittype="text file">
			</list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterText" placeholder="Filter text files..."/>
		</div>
		<div class="preview-container">
			<div class="preview-background" id="model-preview">
				<pre>{{ state.textViewerSelectedText }}</pre>
			</div>
		</div>
		<div class="preview-controls">
			<input type="button" value="Copy to Clipboard" @click="click('copy-text', $event)"/>
			<input type="button" value="Export Selected" @click="click('export-text', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
	</div>
</template>