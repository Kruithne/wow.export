<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state } from '../core';
</script>

<template>
	<div id="loading">
		<div id="loading-background" :class="{ xmas: state.isXmas }"></div>
		<div id="loading-icon"></div>
		<span id="loading-title">{{ state.loadingTitle }}</span>
		<span id="loading-progress">{{ state.loadingProgress }}</span>
		<div id="loading-bar">
			<div :style="{ width: (state.loadPct * 100) + '%' }"></div>
		</div>
	</div>
</template>