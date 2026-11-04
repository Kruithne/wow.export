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
	props: ['items', 'filter', 'selection', 'single', 'keyinput', 'regex', 'copymode', 'pasteselection', 'copytrimwhitespace', 'includefilecount', 'unittype', 'override', 'disable', 'persistscrollkey', 'quickfilters', 'nocopy'],
	emits: ['update:selection', 'update:filter', 'contextmenu'],

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
			activeQuickFilter: null,
			expandedNodes: new Set()
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
			return Math.round((this.rowCount - this.slotCount) * this.scrollRel);
		},

		/**
		 * Whether the listbox renders as a hierarchical tree.
		 */
		treeMode: function() {
			return core.view.config.listboxTreeView === true;
		},

		/**
		 * Total amount of scrollable rows in the current view mode.
		 */
		rowCount: function() {
			return this.treeMode ? this.visibleRows.length : this.filteredItems.length;
		},

		/**
		 * Hierarchical directory tree built from the filtered items.
		 * Each node is { dirs: Map<name, node>, files: [{ name, item }] }.
		 */
		treeRoot: function() {
			if (!this.treeMode)
				return null;

			const root = { dirs: new Map(), files: [] };
			for (const item of this.filteredItems) {
				const parts = item.split('/');
				let node = root;

				for (let i = 0; i < parts.length - 1; i++) {
					const part = parts[i];
					let child = node.dirs.get(part);
					if (!child) {
						child = { dirs: new Map(), files: [] };
						node.dirs.set(part, child);
					}

					node = child;
				}

				node.files.push({ name: parts[parts.length - 1], item });
			}

			return root;
		},

		/**
		 * Flattened array of tree rows currently visible (expanded).
		 * Directories list before files within each level. While a filter is
		 * active, all branches are force-expanded to reveal matches.
		 */
		visibleRows: function() {
			if (!this.treeMode)
				return [];

			const rows = [];
			const forceExpand = (this.debouncedFilter && this.debouncedFilter.trim().length > 0) || this.activeQuickFilter !== null;

			const walk = (node, prefix, depth) => {
				for (const [name, child] of node.dirs) {
					const dirPath = prefix + name;
					const expanded = forceExpand || this.expandedNodes.has(dirPath);
					rows.push({ type: 'dir', name, path: dirPath, depth, expanded });

					if (expanded)
						walk(child, dirPath + '/', depth + 1);
				}

				for (const file of node.files)
					rows.push({ type: 'file', name: file.name, item: file.item, depth });
			};

			walk(this.treeRoot, '', 0);
			return rows;
		},

		/**
		 * Items in visual order, used for range-selection and keyboard
		 * navigation. Matches filteredItems in flat mode, visible tree
		 * files in tree mode.
		 */
		selectionOrderList: function() {
			if (!this.treeMode)
				return this.filteredItems;

			const items = [];
			for (const row of this.visibleRows) {
				if (row.type === 'file')
					items.push(row.item);
			}

			return items;
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
			const source = this.treeMode ? this.visibleRows : this.filteredItems;
			return source.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function() {
			return 1 / this.rowCount;
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
				if (this.nocopy)
					return;

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
					let nextIndex;
					let next;

					if (this.treeMode) {
						// Navigate visible tree rows, skipping directory rows.
						const rows = this.visibleRows;
						const lastRowIndex = rows.findIndex(row => row.type === 'file' && row.item === this.lastSelectItem);

						let rowIndex = lastRowIndex + delta;
						while (rowIndex >= 0 && rowIndex < rows.length && rows[rowIndex].type !== 'file')
							rowIndex += delta;

						if (lastRowIndex > -1 && rowIndex >= 0 && rowIndex < rows.length) {
							nextIndex = rowIndex;
							next = rows[rowIndex].item;
						}
					} else {
						const lastSelectIndex = this.filteredItems.indexOf(this.lastSelectItem);
						nextIndex = lastSelectIndex + delta;
						next = this.filteredItems[nextIndex];
					}

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
						const orderList = this.selectionOrderList;
						const lastSelectIndex = orderList.indexOf(this.lastSelectItem);
						const thisSelectIndex = orderList.indexOf(item);

						const delta = Math.abs(lastSelectIndex - thisSelectIndex);
						const lowest = Math.min(lastSelectIndex, thisSelectIndex);
						const range = orderList.slice(lowest, lowest + delta + 1);

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
		},

		/**
		 * Toggles between flat list and hierarchical tree view.
		 * Persisted globally via configuration.
		 */
		toggleTreeMode: function() {
			core.view.config.listboxTreeView = !this.treeMode;
		},

		/**
		 * Expand or collapse a directory row in tree mode.
		 * @param {object} row
		 */
		toggleExpand: function(row) {
			if (this.expandedNodes.has(row.path))
				this.expandedNodes.delete(row.path);
			else
				this.expandedNodes.add(row.path);
		},

		/**
		 * Invoked when a tree row is clicked. Directories toggle their
		 * expansion state, files delegate to normal selection handling.
		 * @param {object} row
		 * @param {MouseEvent} event
		 */
		handleRowClick: function(row, event) {
			if (row.type === 'dir')
				this.toggleExpand(row);
			else
				this.selectItem(row.item, event);
		},

		/**
		 * Invoked when a user right-clicks an item in the list.
		 * @param {string} item
		 * @param {MouseEvent} event
		 */
		handleContextMenu: function(item, event) {
			event.preventDefault();

			if (this.disable)
				return;

			// select item if not already in selection
			if (!this.selection.includes(item)) {
				const newSelection = this.selection.slice();
				newSelection.splice(0);
				newSelection.push(item);
				this.lastSelectItem = item;
				this.$emit('update:selection', newSelection);
			}

			this.$emit('contextmenu', {
				item,
				selection: this.selection.includes(item) ? this.selection : [item],
				event
			});
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div><div ref="root" class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<template v-if="!treeMode">
			<div v-for="(item, i) in displayItems" class="item" @click="selectItem(item, $event)" @contextmenu="handleContextMenu(item, $event)" :class="{ selected: selection.includes(item) }">
				<span v-for="(sub, si) in item.split('\\31')" :class="'sub sub-' + si" :data-item="sub">{{ sub }}</span>
			</div>
		</template>
		<template v-else>
			<div v-for="(row, i) in displayItems" class="item" :class="{ 'tree-dir': row.type === 'dir', selected: row.type === 'file' && selection.includes(row.item) }" :style="{ paddingLeft: (8 + row.depth * 16) + 'px' }" @click="handleRowClick(row, $event)" @contextmenu="row.type === 'file' && handleContextMenu(row.item, $event)">
				<span v-if="row.type === 'dir'" class="tree-expander">{{ row.expanded ? '−' : '+' }}</span>
				<template v-if="row.type === 'dir'">{{ row.name }}</template>
				<span v-else v-for="(sub, si) in row.name.split('\\31')" :class="'sub sub-' + si" :data-item="sub">{{ sub }}</span>
			</div>
		</template>
	</div>
	<div class="list-status with-quick-filters" v-if="unittype">
		<span>{{ filteredItems.length }} {{ unittype + (filteredItems.length != 1 ? 's' : '') }} found. {{ selection.length > 0 ? ' (' + selection.length + ' selected)' : '' }}</span>
		<span class="quick-filters">
			<a @click="toggleTreeMode" :class="{ active: treeMode }">Tree view</a><template v-if="quickfilters && quickfilters.length > 0"><span> · </span>
			Quick filter: <template v-for="(ext, index) in quickfilters" :key="ext"><a @click="applyQuickFilter(ext)" :class="{ active: activeQuickFilter === ext }">{{ ext.toUpperCase() }}</a><span v-if="index < quickfilters.length - 1"> / </span></template></template>
		</span>
	</div></div>`
};
