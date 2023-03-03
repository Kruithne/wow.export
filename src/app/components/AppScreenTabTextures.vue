<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-textures">
		<div class="list-container">
			<list-box
				:selection="state.selectionTextures"
				:items="state.listfileTextures"
				:override="state.overrideTextureList"
				:filter="state.userInputFilterTextures"
				:keyinput="true"
				:regex="state.config.regexFilters"
				:copymode="state.config.copyMode"
				:pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy"
				:includefilecount="true"
				unittype="texture"
			></list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterTextures" placeholder="Filter textures..."/>
		</div>
		<div class="preview-container">
			<div class="preview-info" v-if="state.config.showTextureInfo && state.texturePreviewInfo.length > 0">{{ state.texturePreviewInfo }}</div>
			<ul class="preview-channels" v-if="state.texturePreviewURL.length > 0">
				<li id="channel-red" :class="{ selected: (state.config.exportChannelMask & 0b1) }" @click.self="state.config.exportChannelMask ^= 0b1" title="Toggle red colour channel.">R</li>
				<li id="channel-green" :class="{ selected: (state.config.exportChannelMask & 0b10) }" @click.self="state.config.exportChannelMask ^= 0b10" title="Toggle green colour channel.">G</li>
				<li id="channel-blue" :class="{ selected: (state.config.exportChannelMask & 0b100) }" @click.self="state.config.exportChannelMask ^= 0b100" title="Toggle blue colour channel.">B</li>
				<li id="channel-alpha" :class="{ selected: (state.config.exportChannelMask & 0b1000) }" @click.self="state.config.exportChannelMask ^= 0b1000" title="Toggle alpha channel.">A</li>
			</ul>
			<div class="preview-background" id="texture-preview" :style="{ 'max-width': state.texturePreviewWidth + 'px', 'max-height': state.texturePreviewHeight + 'px' }">
				<div class="image" :style="{ 'background-image': 'url(' + state.texturePreviewURL + ')' }"></div>
			</div>
		</div>
		<div class="preview-controls">
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.config.showTextureInfo"/>
				<span>Show Info</span>
			</label>
			<label class="ui-checkbox">
				<input type="checkbox" :checked="!!(state.config.exportChannelMask & 0b1000)" @change="($event.target as HTMLInputElement).checked ? state.config.exportChannelMask |= 0b1000 : state.config.exportChannelMask &= 0b0111"/>
				<span>Transparency</span>
			</label>
			<menu-button :options="state.menuButtonTextures" :default="state.config.exportTextureFormat" @change="state.config.exportTextureFormat = $event" :disabled="state.isBusy" @click="click('export-texture', $event)"></menu-button>
		</div>
	</div>
</template>