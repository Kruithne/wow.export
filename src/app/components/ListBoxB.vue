<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div ref="root" class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }">
			<div></div>
		</div>
		<div v-for="item in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
			<span class="sub sub-0">{{ item.label }}</span>
		</div>
	</div>
</template>

<script lang="ts" setup>
	import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
	import { copyToClipboard } from '../system';
	import type { SkinInfo } from '../ui/tab-models';
	import Events from '../events';

	defineEmits(['options']);
	const props = defineProps({
		/** Item entries displayed in the list. */
		'items': { type: Array<SkinInfo>, required: true },

		/** Reactive selection controller. */
		'selection': { type: Array<SkinInfo>, required: true },

		/** If set, only one entry can be selected. */
		'single': Boolean,

		/** If true, listbox registers for keyboard input. */
		'keyinput': Boolean
	});

	const root = ref<HTMLDivElement>();
	const scroller = ref<HTMLDivElement>();

	const scroll = ref(0);
	const scrollRel = ref(0);
	const isScrolling = ref(false);
	const slotCount = ref(1);

	let lastSelectItem: SkinInfo | null = null;
	let scrollStartY: number;
	let scrollStart: number;

	const observer = new ResizeObserver(resize);

	const scrollOffset = computed(() => (scroll.value) + 'px');
	const scrollIndex = computed(() => Math.round((props.items.length - slotCount.value) * scrollRel.value));
	const displayItems = computed(() => props.items.slice(scrollIndex.value, scrollIndex.value + slotCount.value));
	const itemWeight = computed(() => 1 / props.items.length);

	/** Invoked by a ResizeObserver when the main component node is resized due to layout changes. */
	function resize(): void {
		if (scroller.value && root.value) {
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
	function startMouse(event: MouseEvent): void {
		scrollStartY = event.clientY;
		scrollStart = scroll.value;
		isScrolling.value = true;
	}

	/** Invoked when a mouse-move event is captured globally. */
	function moveMouse(event: MouseEvent): void {
		if (isScrolling.value) {
			scroll.value = scrollStart + (event.clientY - scrollStartY);
			recalculateBounds();
		}
	}

	/** Invoked when a mouse-up event is captured globally. */
	function stopMouse(): void {
		isScrolling.value = false;
	}

	/** Invoked when a mouse-wheel event is captured on the component node. */
	function wheelMouse(event: WheelEvent): void {
		const weight = root.value.clientHeight - (scroller.value.clientHeight);
		const child = root.value.querySelector('.item');

		if (child !== null) {
			const scrollCount = Math.floor(root.value.clientHeight / child.clientHeight);
			const direction = event.deltaY > 0 ? 1 : -1;
			scroll.value += ((scrollCount * itemWeight.value) * weight) * direction;
			recalculateBounds();
		}
	}

	/** Invoked when a keydown event is fired. */
	function handleKey(event: KeyboardEvent): void {
		// If document.activeElement is the document body, then we can safely assume
		// the user is not focusing anything, and can intercept keyboard input.
		if (document.activeElement !== document.body)
			return;

		// User hasn't selected anything in the listbox yet.
		if (!lastSelectItem)
			return;

		if (event.key === 'c' && event.ctrlKey) {
			// Copy selection to clipboard.
			copyToClipboard(props.selection.join('\n'));
		} else {
			// Arrow keys.
			const isArrowUp = event.key === 'ArrowUp';
			const isArrowDown = event.key === 'ArrowDown';
			if (isArrowUp || isArrowDown) {
				const delta = isArrowUp ? -1 : 1;

				// Move/expand selection one.
				const lastSelectIndex = props.items.indexOf(lastSelectItem);
				const nextIndex = lastSelectIndex + delta;
				const next = props.items[nextIndex];
				if (next) {
					const lastViewIndex = isArrowUp ? scrollIndex.value : scrollIndex.value + slotCount.value;
					let diff = Math.abs(nextIndex - lastViewIndex);
					if (isArrowDown)
						diff += 1;

					if ((isArrowUp && nextIndex < lastViewIndex) || (isArrowDown && nextIndex >= lastViewIndex)) {
						const weight = root.value.clientHeight - (scroller.value.clientHeight);
						scroll.value += ((diff * itemWeight.value) * weight) * delta;
						recalculateBounds();
					}

					if (!event.shiftKey || props.single)
						props.selection.splice(0);

					props.selection.push(next);
					lastSelectItem = next;
				}
			}
		}
	}

	/** Invoked when a user selects an item in the list. */
	function selectItem(item: SkinInfo, event: MouseEvent): void {
		const checkIndex = props.selection.indexOf(item);

		if (props.single) {
			// Listbox is in single-entry mode, replace selection.
			if (checkIndex === -1) {
				props.selection.splice(0);
				props.selection.push(item);
			}

			lastSelectItem = item;
		} else {
			if (event.ctrlKey) {
				// Ctrl-key held, so allow multiple selections.
				if (checkIndex > -1)
					props.selection.splice(checkIndex, 1);
				else
					props.selection.push(item);
			} else if (event.shiftKey) {
				// Shift-key held, select a range.
				if (lastSelectItem && lastSelectItem !== item) {
					const lastSelectIndex = props.items.indexOf(lastSelectItem);
					const thisSelectIndex = props.items.indexOf(item);

					const delta = Math.abs(lastSelectIndex - thisSelectIndex);
					const lowest = Math.min(lastSelectIndex, thisSelectIndex);
					const range = props.items.slice(lowest, lowest + delta + 1);

					for (const select of range) {
						if (props.selection.indexOf(select) === -1)
							props.selection.push(select);
					}
				}
			} else if (checkIndex === -1 || (checkIndex > -1 && props.selection.length > 1)) {
				// Normal click, replace entire selection.
				props.selection.splice(0);
				props.selection.push(item);
			}

			lastSelectItem = item;
		}
	}

	onMounted(() => {
		document.addEventListener('mousemove', moveMouse);
		document.addEventListener('mouseup', stopMouse);

		if (props.keyinput)
			document.addEventListener('keydown', handleKey);

		// Register observer for layout changes.
		observer.observe(root.value);
	});

	onBeforeUnmount(() => {
		// Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', moveMouse);
		document.removeEventListener('mouseup', stopMouse);

		if (props.keyinput)
			document.removeEventListener('keydown', handleKey);

		// Disconnect resize observer.
		observer.disconnect();
	});
</script>