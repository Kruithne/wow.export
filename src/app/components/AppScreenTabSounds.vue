<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
	import Events from '../events';
</script>

<template>
	<div class="tab list-tab" id="tab-sounds">
		<div class="list-container">
			<list-box
				:selection="state.selectionSounds"
				:items="state.listfileSounds"
				:filter="state.userInputFilterSounds"
				:keyinput="true" :regex="state.config.regexFilters"
				:copymode="state.config.copyMode"
				:pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy"
				:includefilecount="true" unittype="sound file">
			</list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterSounds" placeholder="Filter sound files..."/>
		</div>
		<div id="sound-player">
			<div id="sound-player-anim" :style="{ 'animation-play-state': state.soundPlayerState ? 'running' : 'paused' }"></div>
			<div id="sound-player-controls">
				<div id="sound-player-info">
					<span>{{ state.soundPlayerSeekFormatted }}</span>
					<span class="title">{{ state.soundPlayerTitle }}</span>
					<span>{{ state.soundPlayerDurationFormatted }}</span>
				</div>
				<slider-component id="slider-seek" v-model="state.soundPlayerSeek" @input="Events.emit('click-sound-seek', $event)"></slider-component>
				<div class="buttons">
					<input type="button" :class="{ isPlaying: !state.soundPlayerState }" @click="click('sound-toggle', $event)"/>
					<slider-component id="slider-volume" v-model="state.config.soundPlayerVolume" @input="state.config.soundPlayerVolume = $event"></slider-component>
				</div>
			</div>
		</div>
		<div class="preview-controls">
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.config.soundPlayerLoop"/>
				<span>Loop</span>
			</label>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.config.soundPlayerAutoPlay"/>
				<span>Autoplay</span>
			</label>
			<input type="button" value="Export Selected" @click="click('export-sound', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
	</div>
</template>