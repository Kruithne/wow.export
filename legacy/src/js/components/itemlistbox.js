/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const IconRender = require('../icon-render');

Vue.component('itemlistbox', {
	/**
	 * items: Item entries displayed in the list.
	 * filter: Optional reactive filter for items.
	 * selection: Reactive selection controller.
	 * single: If set, only one entry can be selected.
	 * keyinput: If true, listbox registers for keyboard input.
	 * regex: If true, filter will be treated as a regular expression.
	 * includefilecount: If true, includes a file counter on the component.
	 * unittype: Unit name for what the listbox contains. Used with includefilecount.
	 */
	props: ['items', 'filter', 'selection', 'single', 'keyinput', 'regex', 'includefilecount', 'unittype'],

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
		}
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

		if (this.keyinput) {
			this.onKeyDown = e => this.handleKey(e);
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
	beforeDestroy: function() {
		// Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		document.removeEventListener('paste', this.onPaste);

		if (this.keyinput)
			document.removeEventListener('keydown', this.onKeyDown);

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
		 * relative scroll and the overal item count. Value is dynamically
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
			this.scroll = (this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
			this.slotCount = Math.floor(this.$refs.root.clientHeight / 26);
		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function() {
			const max = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
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
			const weight = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
			const child = this.$refs.root.querySelector('.item');

			if (child !== null) {
				const scrollCount = Math.floor(this.$refs.root.clientHeight / child.clientHeight);
				const direction = e.deltaY > 0 ? 1 : -1;
				this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
				this.recalculateBounds();
			}
		},

		/**
		 * Invoked when a keydown event is fired.
		 * @param {KeyboardEvent} e 
		 */
		handleKey: function(e) {
			// If document.activeElement is the document body, then we can safely assume
			// the user is not focusing anything, and can intercept keyboard input.
			if (document.activeElement !== document.body)
				return;

			// User hasn't selected anything in the listbox yet.
			if (!this.lastSelectItem)
				return;

			if (e.key === 'c' && e.ctrlKey) {
				// Copy selection to clipboard.
				nw.Clipboard.get().set(this.selection.map(e => e.displayName).join('\n'), 'text');
			} else {
				// Arrow keys.
				const isArrowUp = e.key === 'ArrowUp';
				const isArrowDown = e.key === 'ArrowDown';
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

						if (!e.shiftKey || this.single)
							this.selection.splice(0);

						this.selection.push(next);
						this.lastSelectItem = next;
					}
				}
			}
		},

		/**
		 * Invoked when a user selects an item in the list.
		 * @param {string} item 
		 * @param {MouseEvent} e
		 */
		selectItem: function(item, event) {
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
	},

	watch: {
		/**
		 * Invoked when the displayItems variable changes.
		 */
		displayItems: function() {
			for (const item of this.displayItems)
				IconRender.loadIcon(item.icon);
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div><div ref="root" class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="(item, i) in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
			<div :class="['item-icon', 'icon-' + item.icon ]"></div>
			<div :class="['item-name', 'item-quality-' + item.quality]">{{ item.name }} <span class="item-id">({{ item.id }})</span></div>
			<ul class="item-buttons">
				<li @click.self="$emit('options', item)">Options</li>
			</ul>
		</div>
	</div>
	<div class="list-status" v-if="unittype">{{ filteredItems.length }} {{ unittype + (filteredItems.length != 1 ? 's' : '') }} found. {{ selection.length > 0 ? ' (' + selection.length + ' selected)' : '' }}</div></div>`
});