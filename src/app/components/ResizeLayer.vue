<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div ref="root">
		<slot></slot>
	</div>
</template>

<script lang="ts" setup>
	import { ref, onMounted, onBeforeUnmount } from 'vue';

	const emit = defineEmits(['resize']);

	const root = ref<HTMLDivElement>();
	const observer = new ResizeObserver(() => emit('resize', root.value.clientWidth));

	onMounted(() => observer.observe(root.value));
	onBeforeUnmount(() => observer.disconnect());
</script>