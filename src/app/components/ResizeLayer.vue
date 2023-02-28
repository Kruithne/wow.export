<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div>
		<slot></slot>
	</div>
</template>

<script lang="ts">
	import { defineComponent } from 'vue';

	export default defineComponent({
		emits: ['resize'],

		/**
		 * Invoked when this component is mounted.
		 * @see https://vuejs.org/v2/guide/instance.html
		 *
		 */
		mounted: function(): void {
			this.observer = new ResizeObserver(() => this.$emit('resize', this.$el.clientWidth));
			this.observer.observe(this.$el);
		},

		/**
		 * Invoked before this component is destroyed.
		 * @see https://vuejs.org/v2/guide/instance.html
		 */
		beforeUnmount: function(): void {
			this.observer.disconnect();
		}
	});
</script>