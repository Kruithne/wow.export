<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="ui-slider" @click="handleClick">
		<div class="fill" :style="{ width: (modelValue * 100) + '%' }"></div>
		<div class="handle" ref="handle" @mousedown="startMouse" :style="{ left: (modelValue * 100) + '%' }"></div>
	</div>
</template>

<script lang="ts">
	import { defineComponent } from 'vue';

	export default defineComponent({
		props: {
			/** Slider value between 0 and 1. */
			'modelValue': {
				type: Number,
				default: 0
			}
		},

		emits: ['input'],

		data: function() {
			return {
				isScrolling: false, // True if the slider is being dragged.
			};
		},

		/**
		 * Invoked when the component is mounted.
		 * Used to register global mouse listeners.
		 */
		mounted: function(): void {
			this.onMouseMove = (e: MouseEvent): void => this.moveMouse(e);
			this.onMouseUp = (e: MouseEvent): void => this.stopMouse(e);

			document.addEventListener('mousemove', this.onMouseMove);
			document.addEventListener('mouseup', this.onMouseUp);
		},

		/**
		 * Invoked when the component is destroyed.
		 * Used to unregister global mouse listeners.
		 */
		beforeUnmount: function(): void {
			// Unregister global mouse listeners.
			document.removeEventListener('mousemove', this.onMouseMove);
			document.removeEventListener('mouseup', this.onMouseUp);
		},

		methods: {
			/**
			 * Set the current value of this slider.
			 * @param value
			 */
			setValue: function(value: number): void {
				this.$emit('input', Math.min(1, Math.max(0, value)));
			},

			/**
			 * Invoked when a mouse-down event is captured on the slider handle.
			 * @param event
			 */
			startMouse: function(event: MouseEvent): void {
				this.scrollStartX = event.clientX;
				this.scrollStart = this.modelValue;
				this.isScrolling = true;
			},

			/**
			 * Invoked when a mouse-move event is captured globally.
			 * @param event
			 */
			moveMouse: function(event: MouseEvent): void {
				if (this.isScrolling) {
					const max = this.$el.clientWidth;
					const delta = event.clientX - this.scrollStartX;
					this.setValue(this.scrollStart + (delta / max));
				}
			},

			/**
			 * Invoked when a mouse-up event is captured globally.
			 */
			stopMouse: function(): void {
				this.isScrolling = false;
			},

			/**
			 * Invoked when the user clicks somewhere on the slider.
			 * @param event
			 */
			handleClick: function(event: MouseEvent): void {
				// Don't handle click events on the draggable handle.
				if (event.target === this.$refs.handle)
					return;

				this.setValue(event.offsetX / this.$el.clientWidth);
			}
		}
	});
</script>