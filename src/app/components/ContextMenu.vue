<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="context-menu" v-if="node !== null && node !== false" :class=" { low: isLow, left: isLeft }" :style="{ top: positionY + 'px', left: positionX + 'px' }" @mouseleave="$emit('close')" @click="$emit('close')">
		<div class="context-menu-zone"></div>
		<slot :node="node"></slot>
	</div>
</template>

<script lang="ts" setup>
	import { ref, onBeforeUpdate } from 'vue';

	let clientMouseX: number = 0;
	let clientMouseY: number = 0;

	// Keep a global track of the client mouse position.
	// NIT: This needs to move out of this component.
	window.addEventListener('mousemove', (event: MouseEvent) => {
		clientMouseX = event.clientX;
		clientMouseY = event.clientY;
	});

	defineEmits(['close']);
	defineProps({
		/** Object which this contect menu represents */
		'node': { type: [Object, Boolean], required: true }
	});

	const positionX = ref(0);
	const positionY = ref(0);
	const isLow = ref(false);
	const isLeft = ref(false);

	onBeforeUpdate(() => {
		positionX.value = clientMouseX;
		positionY.value = clientMouseY;
		isLow.value = positionY.value > window.innerHeight / 2;
		isLeft.value = positionX.value > window.innerWidth / 2;
	});
</script>