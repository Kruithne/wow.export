<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, handleToastOptionClick, hideToast, removeOverrideModels, removeOverrideTextures } from '../core';
</script>

<template>
	<div id="toast" v-if="state.toast" :class="state.toast.type">
		{{ state.toast.message }}
		<span v-for="(func, label) in state.toast.options" @click="handleToastOptionClick(func)">{{ label }}</span>
		<div class="close" v-if="state.toast.closable" @click="hideToast(true)"></div>
	</div>
	<div id="toast" v-if="!state.toast && state.screen === 'tab-models' && state.overrideModelList.length > 0" class="progress">
		Filtering models for item: {{ state.overrideModelName }}
		<span @click="removeOverrideModels">Remove</span>
		<div class="close" @click="removeOverrideModels"></div>
	</div>
	<div id="toast" v-if="!state.toast && state.screen === 'tab-textures' && state.overrideTextureList.length > 0" class="progress">
		Filtering textures for item: {{ state.overrideTextureName }}
		<span @click="removeOverrideTextures">Remove</span>
		<div class="close" @click="removeOverrideTextures"></div>
	</div>
</template>