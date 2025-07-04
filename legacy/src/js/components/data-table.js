/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
Vue.component('data-table', {
	/**
	 * selectedOption: An array of strings denoting options shown in the menu.
	 */
	props: ['headers', 'rows'],

	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			isScrolling: false,
			slotCount: 1,
			lastSelectItem: null
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);
		// this.onPaste = e => this.handlePaste(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// document.addEventListener('paste', this.onPaste);

		// if (this.keyinput) {
		// 	this.onKeyDown = e => this.handleKey(e);
		// 	document.addEventListener('keydown', this.onKeyDown);
		// }

		// // Register observer for layout changes.
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.$refs.root);
	},


	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeDestroy: function() {
		// // Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		// document.removeEventListener('paste', this.onPaste);

		// if (this.keyinput)
		// 	document.removeEventListener('keydown', this.onKeyDown);

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
			return Math.round((this.filteredItems.length - this.slotCount) * this.scrollRel);
		},

		/**
		 * Reactively filtered version of the underlying data array.
		 * Automatically refilters when the filter input is changed.
		 */
		filteredItems: function() {
			// Skip filtering if no filter is set.
			if (!this.filter)
				return this.rows;

			let res = this.rows;

			if (this.regex) {
				try {
					const filter = new RegExp(this.filter.trim());
					res = res.filter(e => e.match(filter));
				} catch (e) {
					// Regular expression did not compile, skip filtering.
				}
			} else {
				const filter = this.filter.trim().toLowerCase();
				if (filter.length > 0)
					res = res.filter(e => e.toLowerCase().includes(filter));
			}

			// Remove anything from the user selection that has now been filtered out.
			// Iterate backwards here due to re-indexing as elements are spliced.
			for (let i = this.selection.length - 1; i >= 0; i--) {
				if (!res.includes(this.selection[i]))
					this.selection.splice(i, 1);
			}

			return res;
		},

		/**
		 * Dynamic array of items which should be displayed from the underlying
		 * data array. Reactively updates based on scroll and data.
		 */
		displayItems: function() {
			return this.filteredItems.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function() {
			return 1 / this.filteredItems.length;
		}
	},

	methods: {
		/**
		 * Invoked by a ResizeObserver when the main component node
		 * is resized due to layout changes.
		 */
		resize: function() {
			this.scroll = (this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight)) * this.scrollRel;
			this.slotCount = Math.floor((this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight) / 32);
		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function() {
			const max = this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight);
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
			const weight = this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight);
			const child = this.$refs.root.querySelector('tr');

			if (child !== null) {
				const scrollCount = Math.floor(this.$refs.root.clientHeight / child.clientHeight);
				const direction = e.deltaY > 0 ? 1 : -1;
				this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
				this.recalculateBounds();
			}
		},
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `
		<div ref="root" class="ui-datatable" @wheel="wheelMouse">
			<div class="scroller" ref="dtscroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }">
				<div>
				</div>
			</div>
			<table>
				<thead ref="datatableheader">
					<tr>
						<th v-for="header in headers">{{header}}</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in displayItems">
						<td v-for="field in row">{{field}}</td>
					</tr>
				</tbody>
			</table>
		</div>
	`
});