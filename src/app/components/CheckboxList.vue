<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="ui-checkboxlist" @wheel="wheelMouse" ref="root">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="item in displayItems" class="item" @click="propagateClick($event)" :class="{ selected: item.checked }">
			<input type="checkbox" v-model="item.checked" />
			<span>{{ item.label }}</span>
		</div>
	</div>
</template>

<script lang="ts" setup>
	import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

	type CheckBoxItem = {
		label: string;
		checked: boolean;
	};

	const props = defineProps({
		/** Item entries displayed in the list. */
		'items': { type: Array<CheckBoxItem>, required: true }
	});

	const root = ref<HTMLDivElement>();
	const scroller = ref<HTMLDivElement>();

	const isScrolling = ref(false);
	const scrollRel = ref(0);
	const slotCount = ref(1);
	const scroll = ref(0);

	let scrollStartY: number;
	let scrollStart: number;

	const observer = new ResizeObserver(resize);

	const scrollOffset = computed(() => (scroll.value) + 'px');
	const scrollIndex = computed(() => Math.round((props.items.length - slotCount.value) * scrollRel.value));
	const displayItems = computed(() => props.items.slice(scrollIndex.value, scrollIndex.value + slotCount.value));
	const itemWeight = computed(() => 1 / props.items.length);

	onMounted(() => {
		document.addEventListener('mousemove', moveMouse);
		document.addEventListener('mouseup', stopMouse);

		// Register observer for layout changes.
		observer.observe(root.value);
	});

	onBeforeUnmount(() => {
		document.removeEventListener('mousemove', moveMouse);
		document.removeEventListener('mouseup', stopMouse);

		observer.disconnect();
	});

	/** Invoked by a ResizeObserver when the main component node is resized due to layout changes. */
	function resize(): void {
		if (root.value && scroller.value) {
			scroll.value = (root.value.clientHeight - (scroller.value.clientHeight)) * scrollRel.value;
			slotCount.value = Math.floor(root.value.clientHeight / 26);
		}
	}

	/** Restricts the scroll offset to prevent overflowing and calculates the relative (0-1) offset based on the scroll. */
	function recalculateBounds(): void {
		const max = root.value.clientHeight - (scroller.value.clientHeight);
		scroll.value = Math.min(max, Math.max(0, scroll.value));
		scrollRel.value = scroll.value / max;
	}

	/** Invoked when a mouse-down event is captured on the scroll widget. */
	function startMouse(e: MouseEvent): void {
		scrollStartY = e.clientY;
		scrollStart = scroll.value;
		isScrolling.value = true;
	}

	/** Invoked when a mouse-move event is captured globally. */
	function moveMouse(e: MouseEvent): void {
		if (isScrolling.value) {
			scroll.value = scrollStart + (e.clientY - scrollStartY);
			recalculateBounds();
		}
	}

	/** Invoked when a mouse-up event is captured globally. */
	function stopMouse(): void {
		isScrolling.value = false;
	}

	/** Invoked when a mouse-wheel event is captured on the component node. */
	function wheelMouse(e: WheelEvent): void {
		const weight = root.value.clientHeight - (scroller.value.clientHeight);
		const child = root.value.querySelector('.item');

		if (child !== null) {
			const scrollCount = Math.floor(root.value.clientHeight / child.clientHeight);
			const direction = e.deltaY > 0 ? 1 : -1;
			scroll.value += ((scrollCount * itemWeight.value) * weight) * direction;
			recalculateBounds();
		}
	}

	/** Propagate entry clicks to the child checkbox. */
	function propagateClick(event: MouseEvent): void {
		let target = event.target as HTMLElement;
		if (!target.matches('input')) {
			if (target.matches('span'))
				target = target.parentNode as HTMLElement;

			target.querySelector('input').click();
		}
	}
</script>