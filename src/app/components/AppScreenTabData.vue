<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-data">
		<div class="list-container">
			<list-box :selection="state.selectionDB2s" :items="state.listfileDB2s" :filter="state.userInputFilterDB2s" :keyinput="true"
				:regex="state.config.regexFilters" :copydir="state.config.copyFileDirectories" :pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy" :includefilecount="false" unittype="db2 file" :single="true">
			</list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterDB2s" placeholder="Filter DB2s.." />
		</div>
		<div class="list-container">
			<data-table :headers="state.tableBrowserHeaders" :rows="state.tableBrowserRows"></data-table>
		</div>
	</div>
</template>