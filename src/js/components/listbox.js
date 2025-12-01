/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const path = require('path');
const core = require('../core');

const FILTER_DEBOUNCE_MS = 200;

const fid_filter = (e) => {
	const start = e.indexOf(' [');
	const end = e.lastIndexOf(']');

	if (start > -1 && end > -1)
		return e.substring(start + 2, end);

	return e;
};

module.exports = {
	/**
	 * items: Item entries displayed in the list.
	 * filter: Optional reactive filter for items.
	 * selection: Reactive selection controller.
	 * single: If set, only one entry can be selected.
	 * keyinput: If true, listbox registers for keyboard input.
	 * regex: If true, filter will be treated as a regular expression.
	 * copymode: Defines the behavior of CTRL + C.
	 * pasteselection: If true, CTRL + V will load a selection.
	 * copytrimwhitespace: If true, whitespace is trimmed from copied paths.
	 * includefilecount: If true, includes a file counter on the component.
	 * unittype: Unit name for what the listbox contains. Used with includefilecount.
	 * override: If provided, used as an override listfile.
	 * disable: If provided, used as reactive disable flag.
	 * persistscrollkey: If provided, enables scroll position persistence with this key.
	 * quickfilters: Array of file extensions for quick filter links (e.g., ['m2', 'wmo']).
	 */
	props: ['items', 'filter', 'selection', 'single', 'keyinput', 'regex', 'copymode', 'pasteselection', 'copytrimwhitespace', 'includefilecount', 'unittype', 'override', 'disable', 'persistscrollkey', 'quickfilters'],
	emits: ['update:selection', 'update:filter'],

	/**
	 * Reactive instance data.
	 */
	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			isScrolling: false,
			slotCount: 1,
			lastSelectItem: null,
			debouncedFilter: null,
			filterTimeout: null,
			scrollPositionRestored: false,
			activeQuickFilter: null
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);
		this.onPaste = e => this.handlePaste(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		if (this.keyinput)
			this.onKeyDown = e => this.handleKey(e);

		// Register observer for layout changes.
		this.observer = new ResizeObserver(() => this.resize());
		this.observer.observe(this.$refs.root);

		this.debouncedFilter = this.filter;

		if (this.persistscrollkey) {
			this.$nextTick(() => {
				const saved_state = core.getScrollPosition(this.persistscrollkey);
				if (saved_state && this.filteredItems.length > 0 && this.$refs.root && this.$refs.scroller) {
					this.scrollRel = saved_state.scrollRel || 0;
					this.scroll = (this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
					this.recalculateBounds();
				}
			});
		}
	},

	/**
	 * Invoked when the component is activated (keep-alive).
	 * Registers keyboard and paste listeners.
	 */
	activated: function() {
		document.addEventListener('paste', this.onPaste);

		if (this.keyinput)
			document.addEventListener('keydown', this.onKeyDown);
	},

	/**
	 * Invoked when the component is deactivated (keep-alive).
	 * Unregisters keyboard and paste listeners.
	 */
	deactivated: function() {
		document.removeEventListener('paste', this.onPaste);

		if (this.keyinput)
			document.removeEventListener('keydown', this.onKeyDown);
	},

	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeUnmount: function() {
		// Save final scroll position if persistence is enabled
		if (this.persistscrollkey)
			core.saveScrollPosition(this.persistscrollkey, this.scrollRel, this.scrollIndex);

		// Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
		document.removeEventListener('paste', this.onPaste);

		if (this.keyinput)
			document.removeEventListener('keydown', this.onKeyDown);

		// Disconnect resize observer.
		this.observer.disconnect();

		clearTimeout(this.filterTimeout);
	},

	watch: {
		filter: function(newFilter) {
			clearTimeout(this.filterTimeout);

			this.filterTimeout = setTimeout(() => {
				this.debouncedFilter = newFilter;
				this.filterTimeout = null;
			}, FILTER_DEBOUNCE_MS);
		},

		filteredItems: function(newItems) {
			if (this.persistscrollkey && newItems.length > 0) {
				this.$nextTick(() => {
					const saved_state = core.getScrollPosition(this.persistscrollkey);
					if (saved_state && !this.scrollPositionRestored) {
						this.scrollRel = saved_state.scrollRel || 0;
						this.scroll = (this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight)) * this.scrollRel;
						this.recalculateBounds();
						this.scrollPositionRestored = true;
					}
				});
			}
		}
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
		 * Returns the active item list to
		 * @returns 
		 */
		itemList: function() {
			return this.override?.length > 0 ? this.override : this.items;
		},

		/**
		 * Reactively filtered version of the underlying data array.
		 * Uses debounced filter to prevent UI stuttering on large datasets.
		 */
		filteredItems: function() {
			let res = this.itemList;

			// apply text filter
			if (this.debouncedFilter) {
				if (this.regex) {
					try {
						const filter = new RegExp(this.debouncedFilter.trim(), 'i');
						res = res.filter(e => e.match(filter));
					} catch (e) {
						// Regular expression did not compile, skip filtering.
					}
				} else {
					const filter = this.debouncedFilter.trim().toLowerCase();
					if (filter.length > 0)
						res = res.filter(e => e.toLowerCase().includes(filter));
				}
			}

			// apply quick filter
			if (this.activeQuickFilter) {
				const pattern = new RegExp(`\\.${this.activeQuickFilter.toLowerCase()}(\\s\\[\\d+\\])?$`, 'i');
				res = res.filter(e => e.match(pattern));
			}

			let hasChanges = false;
			const newSelection = this.selection.filter((item) => {
				const includes = res.includes(item);

				if (!includes)
					hasChanges = true;

				return includes;
			});

			if (hasChanges)
				this.$emit('update:selection', newSelection);

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
			
			if (this.persistscrollkey)
				core.saveScrollPosition(this.persistscrollkey, this.scrollRel, this.scrollIndex);
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
		 * Invoked when a user attempts to paste a selection.
		 * @param {ClipboardEvent} e 
		 */
		handlePaste: function(e) {
			if (this.disable)
				return;

			// Paste selection must be enabled for this feature.
			if (!this.pasteselection)
				return;

			// Replace the current selection with one from the clipboard.
			const entries = e.clipboardData.getData('text').split(/\r?\n/).filter(i => this.itemList.includes(i));
			const newSelection = this.selection.slice();
			newSelection.splice(0);
			newSelection.push(...entries);
			this.$emit('update:selection', newSelection);
		},

		/**
		 * Invoked when a mouse-wheel event is captured on the component node.
		 * @param {WheelEvent} e
		 */
		wheelMouse: function(e) {
			const weight = this.$refs.root.clientHeight - (this.$refs.scroller.clientHeight);
			const child = this.$refs.root.querySelector('.item');

			if (child !== null) {
				const scrollCount = core.view.config.scrollSpeed === 0 ?  
					Math.floor(this.$refs.root.clientHeight / child.clientHeight) : 
					core.view.config.scrollSpeed;
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
				let entries = this.selection.slice();
				if (this.copymode == 'DIR')
					entries = entries.map(e => path.dirname(e));
				else if (this.copymode == 'FID')
					entries = entries.map(fid_filter);

				// Remove whitespace from paths to keep consistency with exports.
				if (this.copytrimwhitespace)
					entries = entries.map(e => e.replace(/\s/g, ''));

				nw.Clipboard.get().set(entries.join('\n'), 'text');
			} else {
				if (this.disable)
					return;

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

						const newSelection = this.selection.slice();

						if (!e.shiftKey || this.single)
							newSelection.splice(0);

						newSelection.push(next);
						this.lastSelectItem = next;
						this.$emit('update:selection', newSelection);
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
			if (this.disable)
				return;

			const checkIndex = this.selection.indexOf(item);
			const newSelection = this.selection.slice();

			if (this.single) {
				// Listbox is in single-entry mode, replace selection.
				if (checkIndex === -1) {
					newSelection.splice(0);
					newSelection.push(item);
				}

				this.lastSelectItem = item;
			} else {
				if (event.ctrlKey) {
					// Ctrl-key held, so allow multiple selections.
					if (checkIndex > -1)
						newSelection.splice(checkIndex, 1);
					else
						newSelection.push(item);
				} else if (event.shiftKey) {
					// Shift-key held, select a range.
					if (this.lastSelectItem && this.lastSelectItem !== item) {
						const lastSelectIndex = this.filteredItems.indexOf(this.lastSelectItem);
						const thisSelectIndex = this.filteredItems.indexOf(item);

						const delta = Math.abs(lastSelectIndex - thisSelectIndex);
						const lowest = Math.min(lastSelectIndex, thisSelectIndex);
						const range = this.filteredItems.slice(lowest, lowest + delta + 1);

						for (const select of range) {
							if (newSelection.indexOf(select) === -1)
								newSelection.push(select);
						}
					}
				} else if (checkIndex === -1 || (checkIndex > -1 && newSelection.length > 1)) {
					// Normal click, replace entire selection.
					newSelection.splice(0);
					newSelection.push(item);
				}

				this.lastSelectItem = item;
			}

			this.$emit('update:selection', newSelection);
		},

		/**
		 * Invoked when a quick filter link is clicked.
		 * @param {string} ext - File extension (e.g., 'm2', 'wmo')
		 */
		applyQuickFilter: function(ext) {
			if (this.activeQuickFilter === ext)
				this.activeQuickFilter = null;
			else
				this.activeQuickFilter = ext;
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div><div ref="root" class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="(item, i) in displayItems" class="item" @click="selectItem(item, $event)" :class="{ selected: selection.includes(item) }">
			<span v-for="(sub, si) in item.split('\\31')" :class="'sub sub-' + si" :data-item="sub">{{ sub }}</span>
		</div>
	</div>
	<div class="list-status" v-if="unittype" :class="{ 'with-quick-filters': quickfilters && quickfilters.length > 0 }">
		<span>{{ filteredItems.length }} {{ unittype + (filteredItems.length != 1 ? 's' : '') }} found. {{ selection.length > 0 ? ' (' + selection.length + ' selected)' : '' }}</span>
		<span v-if="quickfilters && quickfilters.length > 0" class="quick-filters">
			Quick filter: <template v-for="(ext, index) in quickfilters" :key="ext"><a @click="applyQuickFilter(ext)" :class="{ active: activeQuickFilter === ext }">{{ ext.toUpperCase() }}</a><span v-if="index < quickfilters.length - 1"> / </span></template>
		</span>
	</div></div>`
};
