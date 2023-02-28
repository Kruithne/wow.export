<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div>
		<div ref="root" class="ui-listbox" @wheel="wheelMouse">
			<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
			<div v-for="item in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
				<span v-for="(sub, si) in item.split('\\31')" :class="'sub sub-' + si" :data-item="sub">{{ sub }}</span>
			</div>
		</div>
		<div class="list-status" v-if="unittype">{{ filteredItems.length }} {{ unittype + (filteredItems.length != 1 ? 's' : '') }} found. {{ selection.length > 0 ? ' (' + selection.length + ' selected)' : '' }}</div>
	</div>
</template>

<script lang="ts">
	import path from 'node:path';
	import { defineComponent } from 'vue';
	import Events from '../events';

	function fid_filter(e: string): string {
		const start = e.indexOf(' [');
		const end = e.lastIndexOf(']');

		if (start > -1 && end > -1)
			return e.substring(start + 2, end);

		return e;
	}

	export default defineComponent({
		props: {
			/** Item entries displayed in the list. */
			'items': {
				type: Array,
				required: true
			},

			/** Optional reactive filter for items. */
			'filter': {
				type: [String, undefined],
				default: undefined
			},

			/** Reactive selection controller. */
			'selection': {
				type: Array,
				required: true
			},

			/** If set, only one entry can be selected. */
			'single': Boolean,

			/** If true, listbox registers for keyboard input. */
			'keyinput': Boolean,

			/** If true, filter will be treated as a regular expression. */
			'regex': Boolean,

			/** Defines the behavior of CTRL + C. */
			'copymode': {
				type: String,
				required: true
			},

			/** If true, CTRL + V will load a selection. */
			'pasteselection': Boolean,

			/** If true, whitespace is trimmed from copied paths. */
			'copytrimwhitespace': Boolean,

			/** If true, includes a file counter on the component. */
			'includefilecount': Boolean,

			/** Unit name for what the listbox contains. Used with includefilecount. */
			'unittype': {
				type: [String, undefined],
				default: undefined
			},

			/** If provided, used as an override listfile. */
			'override': {
				type: [Array, undefined],
				default: undefined
			}
		},

		/**
		 * Reactive instance data.
		 */
		data: function() {
			return {
				scroll: 0,
				scrollRel: 0,
				isScrolling: false,
				slotCount: 1,
				lastSelectItem: null
			};
		},

		computed: {
			/**
			 * Offset of the scroll widget in pixels.
			 * Between 0 and the height of the component.
			 */
			scrollOffset: function(): string {
				return (this.scroll) + 'px';
			},

			/**
			 * Index which array reading should start at, based on the current
			 * relative scroll and the overal item count. Value is dynamically
			 * capped based on slot count to prevent empty slots appearing.
			 */
			scrollIndex: function(): number {
				return Math.round((this.filteredItems.length - this.slotCount) * this.scrollRel);
			},

			/**
			 * Returns the active item list to
			 * @returns
			 */
			itemList: function(): Array<string> {
				return this.override?.length > 0 ? this.override : this.items;
			},

			/**
			 * Reactively filtered version of the underlying data array.
			 * Automatically refilters when the filter input is changed.
			 */
			filteredItems: function(): Array<string> {
				// Skip filtering if no filter is set.
				if (!this.filter)
					return this.itemList;

				let res = this.itemList;

				if (this.regex) {
					try {
						const filter = new RegExp(this.filter.trim(), 'i');
						res = res.filter(e => e.match(filter));
					} catch (e) {
						// Regular expression did not compile, skip filtering.
					}
				} else {
					const filter = this.filter.trim().toLowerCase();
					if (filter.length > 0)
						res = res.filter(e => e.toLowerCase().includes(filter));
				}

				return res;
			},

			/**
			 * Dynamic array of items which should be displayed from the underlying
			 * data array. Reactively updates based on scroll and data.
			 */
			displayItems: function(): Array<string> {
				return this.filteredItems.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
			},

			/**
			 * Weight (0-1) of a single item.
			 */
			itemWeight: function(): number {
				return 1 / this.filteredItems.length;
			}
		},

		watch: {
			/**
			 * Invoked when the filteredItems computed property changes.
			 * @param filteredItems - New state of the filteredItems computed property.
			 */
			filteredItems: function(filteredItems): void {
				// Remove anything from the user selection that has now been filtered out.
				// Iterate backwards here due to re-indexing as elements are spliced.
				for (let i = this.selection.length - 1; i >= 0; i--) {
					if (!filteredItems.includes(this.selection[i]))
						this.selection.splice(i, 1);
				}
			}
		},

		/**
		 * Invoked when the component is mounted.
		 * Used to register global listeners and resize observer.
		 */
		mounted: function(): void {
			this.onMouseMove = (e: MouseEvent): void => this.moveMouse(e);
			this.onMouseUp = (e: MouseEvent): void => this.stopMouse(e);
			this.onPaste = (e: ClipboardEvent): void => this.handlePaste(e);

			document.addEventListener('mousemove', this.onMouseMove);
			document.addEventListener('mouseup', this.onMouseUp);

			document.addEventListener('paste', this.onPaste);

			if (this.keyinput) {
				this.onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);
				document.addEventListener('keydown', this.onKeyDown);
			}

			// Register observer for layout changes.
			this.observer = new ResizeObserver(() => this.resize());
			this.observer.observe(this.$refs.root);
		},

		/**
		 * Invoked when the component is destroyed.
		 * Used to unregister global mouse listeners and resize observer.
		 */
		beforeUnmount: function(): void {
			// Unregister global mouse/keyboard listeners.
			document.removeEventListener('mousemove', this.onMouseMove);
			document.removeEventListener('mouseup', this.onMouseUp);

			document.removeEventListener('paste', this.onPaste);

			if (this.keyinput)
				document.removeEventListener('keydown', this.onKeyDown);

			// Disconnect resize observer.
			this.observer.disconnect();
		},

		methods: {
			/**
			 * Invoked by a ResizeObserver when the main component node
			 * is resized due to layout changes.
			 */
			resize: function(): void {
				if (this.$refs.root && this.$refs.scroller) {
					this.scroll = (this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
					this.slotCount = Math.floor(this.$refs.root.clientHeight / 26);
				}
			},

			/**
			 * Restricts the scroll offset to prevent overflowing and
			 * calculates the relative (0-1) offset based on the scroll.
			 */
			recalculateBounds: function(): void {
				const max = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
				this.scroll = Math.min(max, Math.max(0, this.scroll));
				this.scrollRel = this.scroll / max;
			},

			/**
			 * Invoked when a mouse-down event is captured on the scroll widget.
			 * @param event
			 */
			startMouse: function(event: MouseEvent): void {
				this.scrollStartY = event.clientY;
				this.scrollStart = this.scroll;
				this.isScrolling = true;
			},

			/**
			 * Invoked when a mouse-move event is captured globally.
			 * @param event
			 */
			moveMouse: function(event: MouseEvent): void {
				if (this.isScrolling) {
					this.scroll = this.scrollStart + (event.clientY - this.scrollStartY);
					this.recalculateBounds();
				}
			},

			/**
			 * Invoked when a mouse-up event is captured globally.
			 */
			stopMouse: function(): void {
				this.isScrolling = false;
			},

			/**
			 * Invoked when a user attempts to paste a selection.
			 * @param event
			 */
			handlePaste: function(event: ClipboardEvent): void {
				// Paste selection must be enabled for this feature.
				if (!this.pasteselection)
					return;

				// Replace the current selection with one from the clipboard.
				const entries = event.clipboardData.getData('text').split(/\r?\n/).filter(i => this.itemList.includes(i));
				this.selection.splice(0);
				this.selection.push(...entries);
			},

			/**
			 * Invoked when a mouse-wheel event is captured on the component node.
			 * @param event
			 */
			wheelMouse: function(event: WheelEvent): void {
				const weight = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
				const child = this.$refs.root.querySelector('.item');

				if (child !== null) {
					const scrollCount = Math.floor(this.$refs.root.clientHeight / child.clientHeight);
					const direction = event.deltaY > 0 ? 1 : -1;
					this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
					this.recalculateBounds();
				}
			},

			/**
			 * Invoked when a keydown event is fired.
			 * @param event
			 */
			handleKey: function(event: KeyboardEvent): void {
				// If document.activeElement is the document body, then we can safely assume
				// the user is not focusing anything, and can intercept keyboard input.
				if (document.activeElement !== document.body)
					return;

				// User hasn't selected anything in the listbox yet.
				if (!this.lastSelectItem)
					return;

				if (event.key === 'c' && event.ctrlKey) {
					// Copy selection to clipboard.
					let entries = this.selection;
					if (this.copymode == 'DIR')
						entries = entries.map(e => path.dirname(e));
					else if (this.copymode == 'FID')
						entries = entries.map(fid_filter);

					// Remove whitespace from paths to keep consistency with exports.
					if (this.copytrimwhitespace)
						entries = entries.map(e => e.replace(/\s/g, ''));

					Events.emit('copy-to-clipboard', entries.join('\n'));
				} else {
					// Arrow keys.
					const isArrowUp = event.key === 'ArrowUp';
					const isArrowDown = event.key === 'ArrowDown';
					if (isArrowUp || isArrowDown) {
						const delta = isArrowUp ? -1 : 1;

						// Move/expand selection one.
						const lastSelectIndex = this.filteredItems.indexOf(this.lastSelectItem);
						const nextIndex = lastSelectIndex + delta;
						const next = this.filteredItems[nextIndex];
						if (next) {
							const lastViewIndex = isArrowUp ? this.scrollIndex : this.scrollIndex + this.slotCount;
							let diff = Math.abs(nextIndex - lastViewIndex);
							if (isArrowDown)
								diff += 1;

							if ((isArrowUp && nextIndex < lastViewIndex) || (isArrowDown && nextIndex >= lastViewIndex)) {
								const weight = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
								this.scroll += ((diff * this.itemWeight) * weight) * delta;
								this.recalculateBounds();
							}

							if (!event.shiftKey || this.single)
								this.selection.splice(0);

							this.selection.push(next);
							this.lastSelectItem = next;
						}
					}
				}
			},

			/**
			 * Invoked when a user selects an item in the list.
			 * @param item
			 * @param event
			 */
			selectItem: function(item: string, event: MouseEvent): void {
				const checkIndex = this.selection.indexOf(item);

				if (this.single) {
					// Listbox is in single-entry mode, replace selection.
					if (checkIndex === -1) {
						this.selection.splice(0);
						this.selection.push(item);
					}

					this.lastSelectItem = item;
				} else {
					if (event.ctrlKey) {
						// Ctrl-key held, so allow multiple selections.
						if (checkIndex > -1)
							this.selection.splice(checkIndex, 1);
						else
							this.selection.push(item);
					} else if (event.shiftKey) {
						// Shift-key held, select a range.
						if (this.lastSelectItem && this.lastSelectItem !== item) {
							const lastSelectIndex = this.filteredItems.indexOf(this.lastSelectItem);
							const thisSelectIndex = this.filteredItems.indexOf(item);

							const delta = Math.abs(lastSelectIndex - thisSelectIndex);
							const lowest = Math.min(lastSelectIndex, thisSelectIndex);
							const range = this.filteredItems.slice(lowest, lowest + delta + 1);

							for (const select of range) {
								if (this.selection.indexOf(select) === -1)
									this.selection.push(select);
							}
						}
					} else if (checkIndex === -1 || (checkIndex > -1 && this.selection.length > 1)) {
						// Normal click, replace entire selection.
						this.selection.splice(0);
						this.selection.push(item);
					}

					this.lastSelectItem = item;
				}
			}
		}
	});
</script>