/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
Vue.component('checkboxlist', {
	/**
	 * items: Item entries displayed in the list.
	 */
	props: ['items'],

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

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);

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
	beforeDestroy: function() {
		// Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		// Disconnect resize observer.
		this.observer.disconnect();
	},

	computed: {
		/**
		 * Offset of the scroll widget in pixels.
		 * Between 0 and the height of the component.
		 */
		scrollOffset: function() {
			return (this.scroll) + 'px';
		},

		/**
		 * Index which array reading should start at, based on the current
		 * relative scroll and the overall item count. Value is dynamically
		 * capped based on slot count to prevent empty slots appearing.
		 */
		scrollIndex: function() {
			return Math.round((this.items.length - this.slotCount) * this.scrollRel);
		},

		/**
		 * Dynamic array of items which should be displayed from the underlying
		 * data array. Reactively updates based on scroll and data.
		 */
		displayItems: function() {
			return this.items.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function() {
			return 1 / this.items.length;
		}
	},

	methods: {
		/**
		 * Invoked by a ResizeObserver when the main component node
		 * is resized due to layout changes.
		 */
		resize: function() {
			this.scroll = (this.$el.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
			this.slotCount = Math.floor(this.$el.clientHeight / 26);

		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function() {
			const max = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			this.scroll = Math.min(max, Math.max(0, this.scroll));
			this.scrollRel = this.scroll / max;
		},

		/**
		 * Invoked when a mouse-down event is captured on the scroll widget.
		 * @param {MouseEvent} e
		 */
		startMouse: function(e) {
			this.scrollStartY = e.clientY;
			this.scrollStart = this.scroll;
			this.isScrolling = true;
		},

		/**
		 * Invoked when a mouse-move event is captured globally.
		 * @param {MouseEvent} e
		 */
		moveMouse: function(e) {
			if (this.isScrolling) {
				this.scroll = this.scrollStart + (e.clientY - this.scrollStartY);
				this.recalculateBounds();
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 */
		stopMouse: function() {
			this.isScrolling = false;
		},

		/**
		 * Invoked when a mouse-wheel event is captured on the component node.
		 * @param {WheelEvent} e
		 */
		wheelMouse: function(e) {
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
		 * @param {MouseEvent} event
		 */
		propagateClick: function(event) {
			let target = event.target;
			if (!target.matches('input')) {
				if (target.matches('span'))
					target = target.parentNode;

				target.querySelector('input').click();
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-checkboxlist" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="(item, i) in displayItems" class="item" @click="propagateClick($event)" :class="{ selected: item.checked }">
			<input type="checkbox" v-model="item.checked"/>
			<span>{{ item.label }}</span>
		</div>
	</div>`
});