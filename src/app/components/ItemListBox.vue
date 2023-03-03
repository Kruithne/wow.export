<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div>
		<div ref="root" class="ui-listbox" @wheel="wheelMouse">
			<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
			<div v-for="item in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
				<div :class="['item-icon', 'icon-' + item.icon ]"></div>
				<div :class="['item-name', 'item-quality-' + item.quality]">{{ item.name }} <span class="item-id">({{ item.id }})</span></div>
				<ul class="item-buttons">
					<li @click.self="$emit('options', item)">Options</li>
				</ul>
			</div>
		</div>
		<div class="list-status" v-if="unittype">{{ filteredItems.length }} {{ unittype + (filteredItems.length != 1 ? 's' : '') }} found. {{ selection.length > 0 ? ' (' + selection.length + ' selected)' : '' }}</div>
	</div>
</template>

<script lang="ts" setup>
	import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
	import { setClipboard } from '../system';

	import * as IconRender from '../icon-render';
	import { ItemType } from '../ui/tab-items';
	import Events from '../events';

	defineEmits(['options']);
	const props = defineProps({
		/** Item entries displayed in the list. */
		'items': { type: Array<ItemType>, required: true },

		/** Optional reactive filter for items. */
		'filter': { type: [String, undefined], default: undefined },

		/** Reactive selection controller. */
		'selection': { type: Array<ItemType>, required: true },

		/** If set, only one entry can be selected. */
		'single': Boolean,

		/** If true, listbox registers for keyboard input. */
		'keyinput': Boolean,

		/** If true, filter will be treated as a regular expression. */
		'regex': Boolean,

		/** If true, includes a file counter on the component. */
		'includefilecount': Boolean,

		/** Unit name for what the listbox contains. Used with includefilecount. */
		'unittype': { type: [String, undefined], default: undefined }
	});

	const root = ref<HTMLDivElement>();
	const scroller = ref<HTMLDivElement>();

	const scroll = ref(0);
	const scrollRel = ref(0);
	const isScrolling = ref(false);
	const slotCount = ref(1);

	let scrollStartY: number;
	let scrollStart: number;

	let lastSelectItem: ItemType | null = null;

	const observer = new ResizeObserver(resize);

	const scrollOffset = computed(() => (scroll.value) + 'px');
	const scrollIndex = computed(() => Math.round((filteredItems.value.length - slotCount.value) * scrollRel.value));
	const displayItems = computed(() => filteredItems.value.slice(scrollIndex.value, scrollIndex.value + slotCount.value));
	const itemWeight = computed(() => 1 / filteredItems.value.length);
	const filteredItems = computed(() => {
		// Skip filtering if no filter is set.
		if (!props.filter)
			return props.items;

		let res = props.items;
		if (props.regex) {
			try {
				const filter = new RegExp(props.filter.trim(), 'i');
				res = res.filter(e => e.displayName.match(filter));
			} catch (e) {
				// Regular expression did not compile, skip filtering.
			}
		} else {
			const filter = props.filter.trim().toLowerCase();
			if (filter.length > 0)
				res = res.filter(e => e.displayName.toLowerCase().includes(filter));
		}

		return res;
	});

	watch(filteredItems, (filteredItems) => {
		// Remove anything from the user selection that has now been filtered out.
		// Iterate backwards here due to re-indexing as elements are spliced.
		for (let i = props.selection.length - 1; i >= 0; i--) {
			if (!filteredItems.includes(props.selection[i]))
				props.selection.splice(i, 1);
		}
	});

	watch(displayItems, () => {
		for (const item of displayItems.value)
			IconRender.loadIcon(item.icon);
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
			setClipboard(props.selection.map((e: ItemType) => e.displayName).join('\n'));
		} else {
			// Arrow keys.
			const isArrowUp = event.key === 'ArrowUp';
			const isArrowDown = event.key === 'ArrowDown';
			if (isArrowUp || isArrowDown) {
				const delta = isArrowUp ? -1 : 1;

				// Move/expand selection one.
				const lastSelectIndex = filteredItems.value.indexOf(lastSelectItem);
				const nextIndex = lastSelectIndex + delta;
				const next = filteredItems.value[nextIndex];
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
	function selectItem(item: ItemType, event: MouseEvent): void {
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
					const lastSelectIndex = filteredItems.value.indexOf(lastSelectItem);
					const thisSelectIndex = filteredItems.value.indexOf(item);

					const delta = Math.abs(lastSelectIndex - thisSelectIndex);
					const lowest = Math.min(lastSelectIndex, thisSelectIndex);
					const range = filteredItems.value.slice(lowest, lowest + delta + 1);

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