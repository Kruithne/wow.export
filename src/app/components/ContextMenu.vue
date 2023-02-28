<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="context-menu" v-if="node !== null && node !== false" :class=" { low: isLow, left: isLeft }" :style="{ top: positionY + 'px', left: positionX + 'px' }" @mouseleave="$emit('close')" @click="$emit('close')">
		<div class="context-menu-zone"></div>
		<slot :node="node"></slot>
	</div>
</template>

<script lang="ts">
	import { defineComponent } from 'vue';

	let clientMouseX: number = 0;
	let clientMouseY: number = 0;

	// Keep a global track of the client mouse position.
	window.addEventListener('mousemove', (event: MouseEvent) => {
		clientMouseX = event.clientX;
		clientMouseY = event.clientY;
	});

	export default defineComponent({
		props: {
			/** Object which this contect menu represents */
			'node': {
				type: [Object, Boolean],
				required: true
			},
		},

		emits: ['close'],

		data: function() {
			return {
				positionX: 0,
				positionY: 0,
				isLow: false,
				isLeft: false,
			};
		},

		/**
		 * Invoked when this component is about to update.
		 * @see https://vuejs.org/v2/guide/instance.html
		 */
		beforeUpdate: function(): void {
			this.positionX = clientMouseX;
			this.positionY = clientMouseY;
			this.isLow = this.positionY > window.innerHeight / 2;
			this.isLeft = this.positionX > window.innerWidth / 2;
		}
	});
</script>