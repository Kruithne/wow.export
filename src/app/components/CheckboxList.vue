<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="ui-checkboxlist" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="item in displayItems" class="item" @click="propagateClick($event)" :class="{ selected: item.checked }">
			<input type="checkbox" v-model="item.checked" />
			<span>{{ item.label }}</span>
		</div>
	</div>
</template>

<script lang="ts">
	import { defineComponent } from 'vue';

	type CheckBoxItem = {
		label: string;
		checked: boolean;
	};

	export default defineComponent({
		props: {
			/** Item entries displayed in the list. */
			'items': {
				type: Array<CheckBoxItem>,
				required: true
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
				slotCount: 1
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
			 * relative scroll and the overall item count. Value is dynamically
			 * capped based on slot count to prevent empty slots appearing.
			 */
			scrollIndex: function(): number {
				return Math.round((this.items.length - this.slotCount) * this.scrollRel);
			},

			/**
			 * Dynamic array of items which should be displayed from the underlying
			 * data array. Reactively updates based on scroll and data.
			 */
			displayItems: function(): Array<CheckBoxItem> {
				return this.items.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
			},

			/**
			 * Weight (0-1) of a single item.
			 */
			itemWeight: function(): number {
				return 1 / this.items.length;
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

			// Register observer for layout changes.
			this.observer = new ResizeObserver(() => this.resize());
			this.observer.observe(this.$el);
		},

		/**
		 * Invoked when the component is destroyed.
		 * Used to unregister global mouse listeners and resize observer.
		 */
		beforeUnmount: function(): void {
			// Unregister global mouse/keyboard listeners.
			document.removeEventListener('mousemove', this.onMouseMove);
			document.removeEventListener('mouseup', this.onMouseUp);

			// Disconnect resize observer.
			this.observer.disconnect();
		},

		methods: {
			/**
			 * Invoked by a ResizeObserver when the main component node
			 * is resized due to layout changes.
			 */
			resize: function(): void {
				if (this.$el && this.$refs.scroller) {
					this.scroll = (this.$el.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
					this.slotCount = Math.floor(this.$el.clientHeight / 26);
				}

			},

			/**
			 * Restricts the scroll offset to prevent overflowing and
			 * calculates the relative (0-1) offset based on the scroll.
			 */
			recalculateBounds: function(): void {
				const max = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
				this.scroll = Math.min(max, Math.max(0, this.scroll));
				this.scrollRel = this.scroll / max;
			},

			/**
			 * Invoked when a mouse-down event is captured on the scroll widget.
			 * @param e
			 */
			startMouse: function(e: MouseEvent): void {
				this.scrollStartY = e.clientY;
				this.scrollStart = this.scroll;
				this.isScrolling = true;
			},

			/**
			 * Invoked when a mouse-move event is captured globally.
			 * @param e
			 */
			moveMouse: function(e: MouseEvent): void {
				if (this.isScrolling) {
					this.scroll = this.scrollStart + (e.clientY - this.scrollStartY);
					this.recalculateBounds();
				}
			},

			/** Invoked when a mouse-up event is captured globally. */
			stopMouse: function(): void {
				this.isScrolling = false;
			},

			/**
			 * Invoked when a mouse-wheel event is captured on the component node.
			 * @param e
			 */
			wheelMouse: function(e: WheelEvent): void {
				const weight = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
				const child = this.$el.querySelector('.item');

				if (child !== null) {
					const scrollCount = Math.floor(this.$el.clientHeight / child.clientHeight);
					const direction = e.deltaY > 0 ? 1 : -1;
					this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
					this.recalculateBounds();
				}
			},

			/**
			 * Propagate entry clicks to the child checkbox.
			 * @param event
			 */
			propagateClick: function(event: MouseEvent): void {
				let target = event.target as HTMLElement;
				if (!target.matches('input')) {
					if (target.matches('span'))
						target = target.parentNode as HTMLElement;

					target.querySelector('input').click();
				}
			}
		}
	});
</script>