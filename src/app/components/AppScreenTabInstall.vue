<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-install">
		<div class="list-container">
			<list-box :selection="state.selectionInstall" :items="state.listfileInstall" :filter="state.userInputFilterInstall" :keyinput="true" :regex="state.config.regexFilters" :copymode="state.config.copyMode" :pasteselection="state.config.pasteSelection" :copytrimwhitespace="state.config.removePathSpacesCopy" :includefilecount="true" unittype="install file"></list-box>
		</div>
		<div id="tab-install-tray">
			<div class="filter">
				<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="state.userInputFilterInstall" placeholder="Filter install files..."/>
			</div>
			<input type="button" value="Export Selected" @click="click('export-install', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
		<div class="sidebar">
			<label v-for="tag in state.installTags" class="ui-checkbox">
				<input type="checkbox" v-model="tag.enabled"/>
				<span>{{ tag.label }}</span>
			</label>
		</div>
	</div>
</template>