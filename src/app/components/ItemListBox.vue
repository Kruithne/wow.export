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

<script lang="ts">
	import * as IconRender from '../icon-render';
	import { defineComponent } from 'vue';
	import { ItemType } from '../ui/tab-items';

	export default defineComponent({
		props: {
			/** Item entries displayed in the list. */
			'items': {
				type: Array<ItemType>,
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

			/** If true, includes a file counter on the component. */
			'includefilecount': Boolean,

			/** Unit name for what the listbox contains. Used with includefilecount. */
			'unittype': {
				type: [String, undefined],
				default: undefined
			}
		},

		emits: ['options'],

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
			 * Reactively filtered version of the underlying data array.
			 * Automatically refilters when the filter input is changed.
			 */
			filteredItems: function(): Array<ItemType> {
				// Skip filtering if no filter is set.
				if (!this.filter)
					return this.items;

				let res = this.items;

				if (this.regex) {
					try {
						const filter = new RegExp(this.filter.trim(), 'i');
						res = res.filter(e => e.displayName.match(filter));
					} catch (e) {
						// Regular expression did not compile, skip filtering.
					}
				} else {
					const filter = this.filter.trim().toLowerCase();
					if (filter.length > 0)
						res = res.filter(e => e.displayName.toLowerCase().includes(filter));
				}

				return res;
			},

			/**
			 * Dynamic array of items which should be displayed from the underlying
			 * data array. Reactively updates based on scroll and data.
			 */
			displayItems: function(): Array<ItemType> {
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
			},

			/**
			 * Invoked when the displayItems variable changes.
			 */
			displayItems: function(): void {
				for (const item of this.displayItems)
					IconRender.loadIcon(item.icon);
			}
		},

		/**
		 * Invoked when the component is mounted.
		 * Used to register global listeners and resize observer.
		 */
		mounted: function(): void {
			this.onMouseMove = (e: MouseEvent): void => this.moveMouse(e);
			this.onMouseUp = (e: MouseEvent): void => this.stopMouse(e);

			document.addEventListener('mousemove', this.onMouseMove);
			document.addEventListener('mouseup', this.onMouseUp);

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
			 * @param event - Mouse event.
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

			/** Invoked when a mouse-up event is captured globally. */
			stopMouse: function(): void {
				this.isScrolling = false;
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
					nw.Clipboard.get().set(this.selection.map(e => e.displayName).join('\n'), 'text');
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
			selectItem: function(item: ItemType, event: MouseEvent): void {
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