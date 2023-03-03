<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { showPreviousScreen } from '../core';
</script>

<template>
	<div id="changelog">
		<h1>Changelog</h1>
		<pre id="changelog-text">Loading changelog...</pre>
		<input type="button" value="Go Back" @click="showPreviousScreen" />
	</div>
</template>