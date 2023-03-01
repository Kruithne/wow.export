<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="ui-slider" @click="handleClick" ref="root">
		<div class="fill" :style="{ width: (modelValue * 100) + '%' }"></div>
		<div class="handle" ref="handle" @mousedown="startMouse" :style="{ left: (modelValue * 100) + '%' }"></div>
	</div>
</template>

<script lang="ts" setup>
	import { ref, onMounted, onBeforeUnmount } from 'vue';

	const props = defineProps({
		/** Slider value between 0 and 1. */
		'modelValue': { type: Number, default: 0 }
	});

	const emit = defineEmits(['input']);

	const root = ref<HTMLDivElement>();
	const handle = ref<HTMLDivElement>();

	const isScrolling = ref(false);
	const scrollStart = ref(0);
	const scrollStartX = ref(0);

	function setValue(value: number): void {
		emit('input', Math.min(1, Math.max(0, value)));
	}

	function startMouse(event: MouseEvent): void {
		scrollStartX.value = event.clientX;
		scrollStart.value = props.modelValue;
		isScrolling.value = true;
	}

	function moveMouse(event: MouseEvent): void {
		if (isScrolling.value) {
			const max = root.value.clientWidth;
			const delta = event.clientX - scrollStartX.value;
			setValue(scrollStart.value + delta / max);
		}
	}

	function stopMouse(): void {
		isScrolling.value = false;
	}

	function handleClick(event: MouseEvent): void {
		// Don't handle click events on the draggable handle.
		if (event.target === handle.value)
			return;

		setValue(event.offsetX / root.value.clientWidth);
	}

	onMounted(() => {
		document.addEventListener('mousemove', moveMouse);
		document.addEventListener('mouseup', stopMouse);

		onBeforeUnmount(() => {
			document.removeEventListener('mousemove', moveMouse);
			document.removeEventListener('mouseup', stopMouse);
		});
	});
</script>