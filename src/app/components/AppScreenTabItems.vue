<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state } from '../core';
	import { setClipboard } from '../system';
	import ExternalLinks from '../external-links';
	import { viewItemModels, viewItemTextures } from '../ui/tab-items';

	function setAllItemTypes(setState: boolean): void {
		for (const entry of state.itemViewerTypeMask)
			entry.checked = setState;
	}
</script>

<template>
	<div class="tab" id="tab-items">
		<div class="list-container">
			<item-list-box id="listbox-items" :selection="state.selectionItems" :items="state.listfileItems" :filter="state.userInputFilterItems" :keyinput="true" :includefilecount="true" unittype="item" @options="state.contextMenus.nodeItem = $event"></item-list-box>
			<context-menu :node="state.contextMenus.nodeItem" v-slot="context" @close="state.contextMenus.nodeItem = null">
				<span v-if="context.node.modelCount > 0" @click.self="viewItemModels(context.node)">View related models ({{ context.node.modelCount }})</span>
				<span v-if="context.node.textureCount > 0" @click.self="viewItemTextures(context.node)">View related textures ({{ context.node.textureCount }})</span>
				<span @click.self="setClipboard(context.node.name)">Copy item name to clipboard</span>
				<span @click.self="setClipboard(context.node.id)">Copy item ID to clipboard</span>
				<span @click.self="ExternalLinks.openItemOnWowhead(context.node.id)">View item on Wowhead (web)</span>
			</context-menu>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterItems" placeholder="Filter items..."/>
		</div>
		<div id="items-sidebar" class="sidebar">
			<span class="header">Item Types</span>
			<checkbox-list :items="state.itemViewerTypeMask"></checkbox-list>
			<div class="list-toggles">
				<a @click="setAllItemTypes(true)">Enable All</a> / <a @click="setAllItemTypes(false)">Disable All</a>
			</div>
		</div>
	</div>
</template>