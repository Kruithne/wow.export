<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state } from '../core';
</script>

<template>
	<div id="drop-overlay" v-if="!!state.fileDropPrompt">
		<div id="drop-overlay-icon"></div>
		<div id="drop-overlay-text">» {{ state.fileDropPrompt }} «</div>
	</div>
</template>