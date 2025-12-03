/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
module.exports = {
	/**
	 * selectedOption: An array of strings denoting options shown in the menu.
	 */
	props: ['headers', 'rows', 'filter', 'regex', 'selection', 'copyheader'],
	emits: ['update:selection', 'contextmenu', 'copy'],

	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			isScrolling: false,
			horizontalScroll: 0,
			horizontalScrollRel: 0,
			isHorizontalScrolling: false,
			slotCount: 1,
			lastSelectItem: null,
			columnWidths: [],
			manuallyResizedColumns: {},
			isResizing: false,
			resizeColumnIndex: -1,
			resizeStartX: 0,
			resizeStartWidth: 0,
			isOverResizeZone: false,
			resizeZoneColumnIndex: -1,
			sortColumn: -1,
			sortDirection: 'off',
			horizontalScrollAnimationId: null,
			pendingHorizontalUpdate: false,
			targetHorizontalScroll: 0,
			resizeAnimationId: null,
			pendingResizeUpdate: false,
			targetColumnWidth: 0,
			lastSelectItem: null,
			forceHorizontalUpdate: 0,
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global listeners and resize observer.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);
		this.onScroll = e => this.syncScrollPosition(e);
		this.onMiddleMouseDown = e => this.preventMiddleMousePan(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);
		this.$refs.root.addEventListener('scroll', this.onScroll);
		this.$refs.root.addEventListener('mousedown', this.onMiddleMouseDown);

		this.onKeyDown = e => this.handleKey(e);
		document.addEventListener('keydown', this.onKeyDown);

		this.observer = new ResizeObserver(() => {
			this.resize();
		});
		this.observer.observe(this.$refs.root);
		
		this.$nextTick(() => {
			this.calculateColumnWidths();
		});
	},


	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeUnmount: function() {
		// // Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
		document.removeEventListener('keydown', this.onKeyDown);
		
		if (this.$refs.root) {
			this.$refs.root.removeEventListener('scroll', this.onScroll);
			this.$refs.root.removeEventListener('mousedown', this.onMiddleMouseDown);
		}

		if (this.horizontalScrollAnimationId) {
			cancelAnimationFrame(this.horizontalScrollAnimationId);
			this.horizontalScrollAnimationId = null;
		}

		if (this.resizeAnimationId) {
			cancelAnimationFrame(this.resizeAnimationId);
			this.resizeAnimationId = null;
		}

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
			return Math.round((this.sortedItems.length - this.slotCount) * this.scrollRel);
		},

		/**
		 * Reactively filtered version of the underlying data array.
		 * Automatically refilters when the filter input is changed.
		 * Supports both column-specific filters (e.g., "id:5000 name:test") and general filters.
		 */
		filteredItems: function() {
			// Skip filtering if no filter is set.
			if (!this.filter)
				return this.rows;

			const { columnFilters, generalFilter } = this.parseFilterInput(this.filter.trim());
			if (Object.keys(columnFilters).length === 0 && !generalFilter)
				return this.rows;

			let res = this.rows.filter(row => {
				const passesColumnFilters = this.matchesColumnFilters(row, columnFilters, this.regex);
				const passesGeneralFilter = this.matchesGeneralFilter(row, generalFilter, this.regex);
				
				return passesColumnFilters && passesGeneralFilter;
			});

			// Remove anything from the user selection that has now been filtered out.
			// Iterate backwards here due to re-indexing as elements are spliced.
			let hasChanges = false;
			const newSelection = this.selection.filter((rowIndex) => {
				const includes = rowIndex < res.length;
				if (!includes)
					hasChanges = true;
				return includes;
			});

			if (hasChanges)
				this.$emit('update:selection', newSelection);

			return res;
		},

		/**
		 * Sorted version of the filtered data array.
		 * Applies sorting based on sortColumn and sortDirection.
		 */
		sortedItems: function() {
			const filtered = this.filteredItems;
			
			if (this.sortColumn === -1 || this.sortDirection === 'off')
				return filtered;

			const sorted = [...filtered];
			const columnIndex = this.sortColumn;

			sorted.sort((a, b) => {
				const aVal = a[columnIndex];
				const bVal = b[columnIndex];
				
				// Handle null/undefined values
				if (aVal == null && bVal == null)return 0;
				if (aVal == null) return this.sortDirection === 'asc' ? -1 : 1;
				if (bVal == null) return this.sortDirection === 'asc' ? 1 : -1;
				
				// Numeric comparison
				const aNum = Number(aVal);
				const bNum = Number(bVal);
				
				if (!isNaN(aNum) && !isNaN(bNum)) {
					const numResult = aNum - bNum;
					return this.sortDirection === 'asc' ? numResult : -numResult;
				}
				
				// String comparison
				const aStr = String(aVal).toLowerCase();
				const bStr = String(bVal).toLowerCase();
				const strResult = aStr.localeCompare(bStr);
				return this.sortDirection === 'asc' ? strResult : -strResult;
			});

			return sorted;
		},

		/**
		 * Dynamic array of items which should be displayed from the underlying
		 * data array. Reactively updates based on scroll and data.
		 */
		displayItems: function() {
			return this.sortedItems.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		/**
		 * Weight (0-1) of a single item.
		 */
		itemWeight: function() {
			return 1 / this.sortedItems.length;
		},

		/**
		 * Horizontal offset of the scroll widget in pixels.
		 * Between 0 and the width of the component.
		 */
		horizontalScrollOffset: function() {
			return (this.horizontalScroll) + 'px';
		},

		/**
		 * Horizontal offset for the table content based on scroll position.
		 */
		tableHorizontalOffset: function() {
			const scrollRel = this.horizontalScrollRel;
			
			if (!this.$refs.root || !this.$refs.table)
				return 'translateX(0px)';
			
			const containerWidth = this.$refs.root.clientWidth;
			const tableWidth = this.$refs.table.scrollWidth;
			const maxScroll = Math.max(0, tableWidth - containerWidth);
			
			const offset = -maxScroll * scrollRel;
			
			return `translateX(${offset}px)`;
		},

		/**
		 * Determines if horizontal scrollbar should be visible and its width.
		 */
		horizontalScrollbarStyle: function() {
			const _ = this.forceHorizontalUpdate; // force dependency to trigger re-evaluation

			if (!this.displayItems || this.displayItems.length === 0 || !this.$refs.root || !this.$refs.table)
				return { display: 'none' };
			
			const containerWidth = this.$refs.root.clientWidth;
			const tableWidth = this.$refs.table.scrollWidth;
			
			if (tableWidth <= containerWidth)
				return { display: 'none' };
			
			const scrollbarWidth = Math.max(45, (containerWidth / tableWidth) * (containerWidth - 16));
			
			return {
				display: 'block',
				width: scrollbarWidth + 'px'
			};
		},

		/**
		 * Generate column styles with fixed widths and text overflow handling.
		 */
		columnStyles: function() {
			if (!this.columnWidths || this.columnWidths.length === 0) {
				return {};
			}
			
			const styles = {};
			this.columnWidths.forEach((width, index) => {
				styles[`col-${index}`] = {
					width: width + 'px',
					maxWidth: width + 'px',
					minWidth: width + 'px',
					overflow: 'hidden',
					textOverflow: 'ellipsis',
					whiteSpace: 'nowrap'
				};
			});
			
			return styles;
		},

		/**
		 * Dynamic cursor style for header based on resize zone state.
		 */
		headerCursorStyle: function() {
			if (this.isOverResizeZone || this.isResizing) {
				return { cursor: 'col-resize' };
			}
			return {};
		}
	},

	watch: {
		/**
		 * Watch for header changes to recalculate column widths
		 */
		headers: {
			handler: function() {
				this.manuallyResizedColumns = {};
				this.$nextTick(() => {
					this.calculateColumnWidths();
					this.$nextTick(() => {
						this.resetHorizontalScroll();
					});
				});
			},
			immediate: true
		},

		/**
		 * Watch for rows changes to reset selection (new table loaded)
		 */
		rows: {
			handler: function() {
				this.lastSelectItem = null;
				this.$emit('update:selection', []);
				this.$nextTick(() => {
					this.resetHorizontalScroll();
				});
			}
		}
	},

	methods: {
		/**
		 * Parse filter input to extract column-specific filters and general filter.
		 * @param {string} filterInput - The filter input string
		 * @returns {Object} Object containing columnFilters and generalFilter
		 */
		parseFilterInput: function(filterInput) {
			if (!filterInput)
				return { columnFilters: {}, generalFilter: '' };

			const columnFilters = {};
			let generalFilter = '';
			
			// Split by spaces, but preserve quoted strings
			const parts = filterInput.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
			
			for (const part of parts) {
				const colonIndex = part.indexOf(':');
				if (colonIndex > 0 && colonIndex < part.length - 1) {
					// This looks like a column filter (column:value)
					const columnName = part.substring(0, colonIndex).toLowerCase();
					const filterValue = part.substring(colonIndex + 1);
					
					const headerIndex = this.headers.findIndex(header => 
						header.toLowerCase() === columnName
					);
					
					if (headerIndex !== -1) {
						columnFilters[headerIndex] = filterValue;
						continue;
					}
				}
				
				// Not a valid column filter, add to general filter
				if (generalFilter)
					generalFilter += ' ';
				
				generalFilter += part;
			}
			
			return { columnFilters, generalFilter: generalFilter.trim() };
		},

		/**
		 * Check if a row matches the given column filters.
		 * @param {Array} row - The row data
		 * @param {Object} columnFilters - Column-specific filters
		 * @param {boolean} useRegex - Whether to use regex matching
		 * @returns {boolean} True if row matches all column filters
		 */
		matchesColumnFilters: function(row, columnFilters, useRegex) {
			for (const [columnIndex, filterValue] of Object.entries(columnFilters)) {
				const cellValue = String(row[parseInt(columnIndex)]);
				
				if (useRegex) {
					try {
						const filter = new RegExp(filterValue, 'i');
						if (!cellValue.match(filter)) {
							return false;
						}
					} catch (e) {
						// Invalid regex, fall back to string matching
						if (!cellValue.toLowerCase().includes(filterValue.toLowerCase())) {
							return false;
						}
					}
				} else {
					if (!cellValue.toLowerCase().includes(filterValue.toLowerCase())) {
						return false;
					}
				}
			}
			return true;
		},

		/**
		 * Check if a row matches the general filter.
		 * @param {Array} row - The row data
		 * @param {string} generalFilter - General filter string
		 * @param {boolean} useRegex - Whether to use regex matching
		 * @returns {boolean} True if row matches general filter
		 */
		matchesGeneralFilter: function(row, generalFilter, useRegex) {
			if (!generalFilter) return true;
			
			if (useRegex) {
				try {
					const filter = new RegExp(generalFilter, 'i');
					return row.some(field => String(field).match(filter));
				} catch (e) {
					// Invalid regex, fall back to string matching
					const filterLower = generalFilter.toLowerCase();
					return row.some(field => String(field).toLowerCase().includes(filterLower));
				}
			} else {
				const filterLower = generalFilter.toLowerCase();
				return row.some(field => String(field).toLowerCase().includes(filterLower));
			}
		},

		/**
		 * Invoked by a ResizeObserver when the main component node
		 * is resized due to layout changes.
		 */
		resize: function() {
			// Calculate available height for scrolling (subtract header and scrollbar widget)
			const availableHeight = this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight;
			this.scroll = (availableHeight - (this.$refs.dtscroller.clientHeight)) * this.scrollRel;
			this.slotCount = Math.max(1, Math.floor(availableHeight / 32) - 2);
			
			if (this.$refs.dthscroller)
				this.horizontalScroll = (this.$refs.root.clientWidth - (this.$refs.dthscroller.clientWidth)) * this.horizontalScrollRel;
		},

		/**
		 * Restricts the scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the scroll.
		 */
		recalculateBounds: function() {
			const availableHeight = this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight;
			const max = availableHeight - (this.$refs.dtscroller.clientHeight);
			this.scroll = Math.min(max, Math.max(0, this.scroll));
			this.scrollRel = this.scroll / max;
		},

		/**
		 * Restricts the horizontal scroll offset to prevent overflowing and
		 * calculates the relative (0-1) offset based on the horizontal scroll.
		 */
		recalculateHorizontalBounds: function() {
			if (!this.$refs.dthscroller) return;
			const max = this.$refs.root.clientWidth - (this.$refs.dthscroller.clientWidth);
			this.horizontalScroll = Math.min(max, Math.max(0, this.horizontalScroll));
			this.horizontalScrollRel = max > 0 ? this.horizontalScroll / max : 0;
		},

		/**
		 * Determines if horizontal scrolling is needed based on table width vs container width.
		 */
		needsHorizontalScrolling: function() {
			if (!this.$refs.root || !this.$refs.table) return false;
			return this.$refs.table.scrollWidth > this.$refs.root.clientWidth;
		},


		/**
		 * Calculate column widths based on header text length ONLY.
		 * No DOM measurements. No dynamic shit. Just text length.
		 */
		calculateColumnWidths: function() {
			if (!this.headers) return;
			
			const widths = [];
			
			this.headers.forEach((header, index) => {
				const columnName = header;
				
				if (this.manuallyResizedColumns[columnName]) {
					widths.push(this.manuallyResizedColumns[columnName]);
				} else {
					// Calculate width based on text length: 8px per character + 40px for icons/padding
					const textWidth = (header.length * 8) + 40;
					widths.push(Math.max(120, textWidth));
				}
			});

			this.columnWidths = widths;
		},

		/**
		 * Reset horizontal scroll position and force recalculation.
		 * Called when new table data is loaded.
		 */
		resetHorizontalScroll: function() {
			this.horizontalScroll = 0;
			this.horizontalScrollRel = 0;

			if (this.$refs.table) {
				const forceLayout = this.$refs.table.offsetHeight;
				// this triggers a re-evaluation by reading offsetHeight
			}

			this.forceHorizontalUpdate++;
		},

		/**
		 * Sync custom scrollbar position with native scroll position
		 */
		syncScrollPosition: function(e) {
			if (!this.$refs.root || !this.$refs.table || this.isHorizontalScrolling)
				return;
			
			const containerWidth = this.$refs.root.clientWidth;
			const tableWidth = this.$refs.table.scrollWidth;
			const maxScroll = Math.max(0, tableWidth - containerWidth);
			
			if (maxScroll > 0) {
				this.horizontalScrollRel = this.$refs.root.scrollLeft / maxScroll;
				this.horizontalScroll = (this.$refs.root.clientWidth - (this.$refs.dthscroller?.clientWidth || 45)) * this.horizontalScrollRel;
			}
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
			
			if (this.isHorizontalScrolling) {
				this.targetHorizontalScroll = this.horizontalScrollStart + (e.clientX - this.horizontalScrollStartX);
				
				if (!this.pendingHorizontalUpdate) {
					this.pendingHorizontalUpdate = true;
					this.horizontalScrollAnimationId = requestAnimationFrame(() => {
						this.horizontalScroll = this.targetHorizontalScroll;
						this.recalculateHorizontalBounds();
						this.pendingHorizontalUpdate = false;
					});
				}
			}
			
			if (this.isResizing) {
				const deltaX = e.clientX - this.resizeStartX;
				this.targetColumnWidth = Math.max(50, this.resizeStartWidth + deltaX); // Minimum width of 50px
				
				if (!this.pendingResizeUpdate) {
					this.pendingResizeUpdate = true;
					this.resizeAnimationId = requestAnimationFrame(() => {
						// Update the column width
						if (this.columnWidths && this.resizeColumnIndex >= 0 && this.resizeColumnIndex < this.columnWidths.length) {
							this.columnWidths[this.resizeColumnIndex] = this.targetColumnWidth;
							
							// Mark this column as manually resized by column name
							const columnName = this.headers[this.resizeColumnIndex];
							this.manuallyResizedColumns[columnName] = this.targetColumnWidth;
						}
						this.pendingResizeUpdate = false;
					});
				}
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 */
		stopMouse: function() {
			this.isScrolling = false;
			this.isHorizontalScrolling = false;
			
			if (this.horizontalScrollAnimationId) {
				cancelAnimationFrame(this.horizontalScrollAnimationId);
				this.horizontalScrollAnimationId = null;
				this.pendingHorizontalUpdate = false;
				
				if (this.targetHorizontalScroll !== this.horizontalScroll) {
					this.horizontalScroll = this.targetHorizontalScroll;
					this.recalculateHorizontalBounds();
				}
			}
			
			if (this.resizeAnimationId) {
				cancelAnimationFrame(this.resizeAnimationId);
				this.resizeAnimationId = null;
				this.pendingResizeUpdate = false;
				
				if (this.targetColumnWidth !== 0 && this.columnWidths && this.resizeColumnIndex >= 0 && this.resizeColumnIndex < this.columnWidths.length) {
					this.columnWidths[this.resizeColumnIndex] = this.targetColumnWidth;
					const columnName = this.headers[this.resizeColumnIndex];
					this.manuallyResizedColumns[columnName] = this.targetColumnWidth;
				}
			}
			
			if (this.isResizing) {
				this.isResizing = false;
				this.resizeColumnIndex = -1;
				this.isOverResizeZone = false;
				this.resizeZoneColumnIndex = -1;
			}
		},

		/**
		 * Invoked when a mouse-down event is captured on the horizontal scroll widget.
		 * @param {MouseEvent} e 
		 */
		startHorizontalMouse: function(e) {
			this.horizontalScrollStartX = e.clientX;
			this.horizontalScrollStart = this.horizontalScroll;
			this.isHorizontalScrolling = true;
		},

		/**
		 * Invoked when a mouse-wheel event is captured on the component node.
		 * @param {WheelEvent} e
		 */
		wheelMouse: function(e) {
			let delta = e.deltaY;
			if(e.deltaX !== 0)
				delta = e.deltaX;

			if ((e.shiftKey || e.deltaX !== 0) && this.needsHorizontalScrolling()) {
				// Horizontal scrolling with shift+wheel
				const direction = delta > 0 ? 1 : -1;
				const scrollAmount = 50; // Fixed scroll amount for horizontal
				this.horizontalScroll += scrollAmount * direction;
				this.recalculateHorizontalBounds();
				e.preventDefault();
			} else {
				const availableHeight = this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight;
				const weight = availableHeight - (this.$refs.dtscroller.clientHeight);
				const child = this.$refs.root.querySelector('tr');

				if (child !== null) {
					const scrollCount = this.slotCount;
					const direction = e.deltaY > 0 ? 1 : -1;
					this.scroll += ((scrollCount * this.itemWeight) * weight) * direction;
					this.recalculateBounds();
				}
			}
		},

		/**
		 * Invoked when mouse moves over header cells to detect resize zones.
		 * @param {MouseEvent} e
		 */
		headerMouseMove: function(e) {
			if (this.isResizing) return;
			
			const headerCells = this.$refs.datatableheader.querySelectorAll('th');
			const resizeZoneWidth = 5; // 5px zone on each side of border
			
			this.isOverResizeZone = false;
			this.resizeZoneColumnIndex = -1;
			
			for (let i = 0; i < headerCells.length; i++) {
				const cell = headerCells[i];
				const rect = cell.getBoundingClientRect();
				
				if (i < headerCells.length - 1) {
					if (e.clientX >= rect.right - resizeZoneWidth && e.clientX <= rect.right + resizeZoneWidth) {
						this.isOverResizeZone = true;
						this.resizeZoneColumnIndex = i;
						break;
					}
				}
			}
		},

		/**
		 * Invoked when mouse is pressed down on header to potentially start resize.
		 * @param {MouseEvent} e
		 */
		headerMouseDown: function(e) {
			if (this.isOverResizeZone && this.resizeZoneColumnIndex >= 0) {
				this.isResizing = true;
				this.resizeColumnIndex = this.resizeZoneColumnIndex;
				this.resizeStartX = e.clientX;
				this.resizeStartWidth = this.columnWidths[this.resizeZoneColumnIndex];
				e.preventDefault();
			}
		},

		/**
		 * Handle column header clicks for sorting.
		 * @param {number} columnIndex - Index of the clicked column
		 */
		toggleSort: function(columnIndex) {
			if (this.sortColumn === columnIndex) {
				// Same column - cycle through: off -> asc -> desc -> off
				if (this.sortDirection === 'off') {
					this.sortDirection = 'asc';
				} else if (this.sortDirection === 'asc') {
					this.sortDirection = 'desc';
				} else {
					this.sortDirection = 'off';
					this.sortColumn = -1;
				}
			} else {
				// Different column - set to ascending
				this.sortColumn = columnIndex;
				this.sortDirection = 'asc';
			}
		},

		/**
		 * Get sort icon name for a given column.
		 * @param {number} columnIndex - Index of the column
		 * @returns {string} Sort icon class name
		 */
		getSortIconName: function(columnIndex) {
			if (this.sortColumn !== columnIndex || this.sortDirection === 'off')
				return 'sort-icon-off';
			
			return this.sortDirection === 'asc' ? 'sort-icon-up' : 'sort-icon-down';
		},

		/**
		 * Handle clicking the filter icon for a column.
		 * Inserts the column filter prefix and focuses the filter input.
		 * @param {number} columnIndex - Index of the column
		 * @param {Event} e - The click event
		 */
		handleFilterIconClick: function(columnIndex, e) {
			const columnName = this.headers[columnIndex].toLowerCase();
			const filterPrefix = columnName + ':';
			
			const currentFilter = this.filter || '';
			const newFilter = currentFilter ? currentFilter + ' ' + filterPrefix : filterPrefix;
			
			this.$emit('update:filter', newFilter);
			
			this.$nextTick(() => {
				this.$nextTick(() => {
					const filterInput = document.getElementById('data-table-filter-input');
					if (filterInput) {
						filterInput.focus();
						filterInput.setSelectionRange(filterInput.value.length, filterInput.value.length);
					}
				});
			});
		},

		/**
		 * Prevent middle mouse button from triggering autopan.
		 * @param {MouseEvent} e
		 */
		preventMiddleMousePan: function(e) {
			if (e.button === 1)
				e.preventDefault();
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

			// User hasn't selected anything in the table yet.
			if (this.lastSelectItem === null)
				return;

			// CTRL+C to copy selection as CSV.
			if (e.key === 'c' && e.ctrlKey) {
				this.$emit('copy');
				return;
			}

			// Arrow keys.
			const isArrowUp = e.key === 'ArrowUp';
			const isArrowDown = e.key === 'ArrowDown';
			if (isArrowUp || isArrowDown) {
				const delta = isArrowUp ? -1 : 1;

				// Move/expand selection one.
				const lastSelectIndex = this.lastSelectItem;
				const nextIndex = lastSelectIndex + delta;
				if (nextIndex >= 0 && nextIndex < this.sortedItems.length) {
					const lastViewIndex = isArrowUp ? this.scrollIndex : this.scrollIndex + this.slotCount;
					let diff = Math.abs(nextIndex - lastViewIndex);
					if (isArrowDown)
						diff += 1;

					if ((isArrowUp && nextIndex < lastViewIndex) || (isArrowDown && nextIndex >= lastViewIndex)) {
						const availableHeight = this.$refs.root.clientHeight - this.$refs.datatableheader.clientHeight;
						const weight = availableHeight - (this.$refs.dtscroller.clientHeight);
						this.scroll += ((diff * this.itemWeight) * weight) * delta;
						this.recalculateBounds();
					}

					const newSelection = this.selection.slice();

					if (!e.shiftKey)
						newSelection.splice(0);

					newSelection.push(nextIndex);
					this.lastSelectItem = nextIndex;
					this.$emit('update:selection', newSelection);
				}
			}
		},

		/**
		 * Invoked when a user selects a row in the table.
		 * @param {number} rowIndex - Index of the row in sortedItems
		 * @param {MouseEvent} event
		 */
		selectRow: function(rowIndex, event) {
			const checkIndex = this.selection.indexOf(rowIndex);
			const newSelection = this.selection.slice();

			if (event.ctrlKey) {
				// Ctrl-key held, so allow multiple selections.
				if (checkIndex > -1)
					newSelection.splice(checkIndex, 1);
				else
					newSelection.push(rowIndex);
			} else if (event.shiftKey) {
				// Shift-key held, select a range.
				if (this.lastSelectItem !== null && this.lastSelectItem !== rowIndex) {
					const lastSelectIndex = this.lastSelectItem;
					const thisSelectIndex = rowIndex;

					const delta = Math.abs(lastSelectIndex - thisSelectIndex);
					const lowest = Math.min(lastSelectIndex, thisSelectIndex);
					const highest = lowest + delta;

					for (let i = lowest; i <= highest; i++) {
						if (newSelection.indexOf(i) === -1)
							newSelection.push(i);
					}
				}
			} else if (checkIndex === -1 || (checkIndex > -1 && newSelection.length > 1)) {
				// Normal click, replace entire selection.
				newSelection.splice(0);
				newSelection.push(rowIndex);
			}

			this.lastSelectItem = rowIndex;
			this.$emit('update:selection', newSelection);
		},

		/**
		 * Invoked when a user right-clicks on a row in the table.
		 * @param {number} rowIndex - Index of the row in sortedItems
		 * @param {number} columnIndex - Index of the column
		 * @param {MouseEvent} event
		 */
		handleContextMenu: function(rowIndex, columnIndex, event) {
			event.preventDefault();

			// if the row is not already selected, select it
			if (!this.selection.includes(rowIndex)) {
				this.lastSelectItem = rowIndex;
				this.$emit('update:selection', [rowIndex]);
			}

			const row = this.sortedItems[rowIndex];
			const cellValue = row ? row[columnIndex] : null;

			this.$emit('contextmenu', {
				rowIndex,
				columnIndex,
				cellValue,
				selectedCount: Math.max(1, this.selection.length),
				event
			});
		},

		/**
		 * Get selected rows as CSV string.
		 * @returns {string} CSV formatted string
		 */
		getSelectedRowsAsCSV: function() {
			if (!this.selection || this.selection.length === 0 || !this.headers)
				return '';

			const rows = this.selection
				.slice()
				.sort((a, b) => a - b)
				.map(idx => this.sortedItems[idx])
				.filter(row => row !== undefined);

			if (rows.length === 0)
				return '';

			const escape_csv = (val) => {
				const str = String(val ?? '');
				if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r'))
					return '"' + str.replace(/"/g, '""') + '"';

				return str;
			};

			const lines = [];

			if (this.copyheader)
				lines.push(this.headers.map(escape_csv).join(','));

			lines.push(...rows.map(row => row.map(escape_csv).join(',')));

			return lines.join('\n');
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
			<div class="hscroller" ref="dthscroller" @mousedown="startHorizontalMouse" :class="{ using: isHorizontalScrolling }" :style="Object.assign({ left: horizontalScrollOffset }, horizontalScrollbarStyle)">
				<div>
				</div>
			</div>
			<table ref="table" :style="{ transform: tableHorizontalOffset }">
				<thead ref="datatableheader" @mousemove="headerMouseMove" @mousedown="headerMouseDown" :style="headerCursorStyle">
					<tr>
						<th v-for="(header, index) in headers" 
							:style="columnStyles['col-' + index] || {}">
							<span class="header-content">
								{{header}}
								<div class="header-icons">
									<span 
										class="filter-icon" 
										@click="handleFilterIconClick(index, $event)"
										title="Filter this column">
									</span>
									<span 
										:class="'sort-icon ' + getSortIconName(index)" 
										@click="toggleSort(index)"
										title="Sort this column">
									</span>
								</div>
							</span>
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="(row, rowIndex) in displayItems" 
						@click="selectRow(scrollIndex + rowIndex, $event)"
						:class="{ selected: selection.includes(scrollIndex + rowIndex) }">
						<td v-for="(field, index) in row" :style="columnStyles['col-' + index] || {}" @contextmenu="handleContextMenu(scrollIndex + rowIndex, index, $event)">{{field}}</td>
					</tr>
				</tbody>
			</table>
		</div>
	`
};