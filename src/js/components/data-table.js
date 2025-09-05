/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
module.exports = {
	/**
	 * selectedOption: An array of strings denoting options shown in the menu.
	 */
	props: ['headers', 'rows', 'filter', 'regex'],

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
			selection: [],
			forceScrollbarUpdate: 0,
			columnWidths: [],
			manuallyResizedColumns: {},
			isResizing: false,
			resizeColumnIndex: -1,
			resizeStartX: 0,
			resizeStartWidth: 0,
			isOverResizeZone: false,
			resizeZoneColumnIndex: -1,
			sortColumn: -1,
			sortDirection: 'off'
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

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);
		this.$refs.root.addEventListener('scroll', this.onScroll);

		// // Register observer for layout changes.
		this.observer = new ResizeObserver(() => {
			this.resize();
			this.calculateColumnWidths();
		});
		this.observer.observe(this.$refs.root);
		
		// Calculate initial column widths
		this.calculateColumnWidths();
	},


	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners and resize observer.
	 */
	beforeUnmount: function() {
		// // Unregister global mouse/keyboard listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
		if (this.$refs.root)
			this.$refs.root.removeEventListener('scroll', this.onScroll);

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
			return Math.round((this.sortedItems.length - this.slotCount) * this.scrollRel);
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
					const filter = new RegExp(this.filter.trim(), 'i');
					res = res.filter(row => {
						// Search across all fields in the row
						return row.some(field => String(field).match(filter));
					});
				} catch (e) {
					// Regular expression did not compile, skip filtering.
				}
			} else {
				const filter = this.filter.trim().toLowerCase();
				if (filter.length > 0) {
					res = res.filter(row => {
						// Search across all fields in the row
						return row.some(field => String(field).toLowerCase().includes(filter));
					});
				}
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
			this.forceScrollbarUpdate; // Reactive dependency ref
			
			if (!this.displayItems || this.displayItems.length === 0 || !this.$refs.root || !this.$refs.table)
				return { display: 'none' };
			
			const containerWidth = this.$refs.root.clientWidth;
			const tableWidth = this.$refs.table.scrollWidth;
			
			// Only show scrollbar if table is wider than container 
			if (tableWidth <= containerWidth)
				return { display: 'none' };
			
			// Calculate scrollbar width based on content ratio
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
		 * Watch for data changes to refresh scrollbar visibility
		 */
		rows: {
			handler: function() {
				this.$nextTick(() => {
					this.refreshHorizontalScrollbar();
				});
			},
			immediate: true
		},

		/**
		 * Watch for header changes to recalculate column widths
		 */
		headers: {
			handler: function() {
				this.$nextTick(() => {
					this.calculateColumnWidths();
				});
			},
			immediate: true
		},

		filteredItems: {
			handler: function() {
				this.$nextTick(() => {
					this.refreshHorizontalScrollbar();
				});
			},
			immediate: true
		},

		displayItems: {
			handler: function() {
				this.$nextTick(() => {
					this.refreshHorizontalScrollbar();
				});
			},
			immediate: true
		},

		sortedItems: {
			handler: function() {
				this.$nextTick(() => {
					this.refreshHorizontalScrollbar();
				});
			},
			immediate: true
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
			
			if (this.$refs.dthscroller)
				this.horizontalScroll = (this.$refs.root.clientWidth - (this.$refs.dthscroller.clientWidth)) * this.horizontalScrollRel;
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
		 * Refresh horizontal scrollbar state based on current content
		 */
		refreshHorizontalScrollbar: function() {
			if (!this.$refs.root || !this.$refs.table) return;
			
			// Trigger computed property re-evaluation by changing reactive data
			this.forceScrollbarUpdate++;
		},

		/**
		 * Calculate and store column widths based on header cell widths.
		 * Preserves manually resized columns.
		 */
		calculateColumnWidths: function() {
			if (!this.$refs.datatableheader || !this.headers) return;
			
			this.$nextTick(() => {
				const headerCells = this.$refs.datatableheader.querySelectorAll('th');
				const widths = [];
				
				headerCells.forEach((cell, index) => {
					const columnName = this.headers[index];
					if (this.manuallyResizedColumns[columnName]) {
						widths.push(this.manuallyResizedColumns[columnName]);
					} else {
						widths.push(Math.max(100, cell.offsetWidth)); // Minimum 100px width
					}
				});
				
				this.columnWidths = widths;
			});
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
				this.horizontalScroll = this.horizontalScrollStart + (e.clientX - this.horizontalScrollStartX);
				this.recalculateHorizontalBounds();
			}
			
			if (this.isResizing) {
				const deltaX = e.clientX - this.resizeStartX;
				const newWidth = Math.max(50, this.resizeStartWidth + deltaX); // Minimum width of 50px
				
				// Update the column width
				if (this.columnWidths && this.resizeColumnIndex >= 0 && this.resizeColumnIndex < this.columnWidths.length) {
					this.columnWidths[this.resizeColumnIndex] = newWidth;
					
					// Mark this column as manually resized by column name
					const columnName = this.headers[this.resizeColumnIndex];
					this.manuallyResizedColumns[columnName] = newWidth;
				}
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 */
		stopMouse: function() {
			this.isScrolling = false;
			this.isHorizontalScrolling = false;
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
			if (e.shiftKey && this.needsHorizontalScrolling()) {
				// Horizontal scrolling with shift+wheel
				const direction = e.deltaY > 0 ? 1 : -1;
				const scrollAmount = 50; // Fixed scroll amount for horizontal
				this.horizontalScroll += scrollAmount * direction;
				this.recalculateHorizontalBounds();
				e.preventDefault();
			} else {
				// Vertical scrolling
				const weight = this.$refs.root.clientHeight - (this.$refs.dtscroller.clientHeight);
				const child = this.$refs.root.querySelector('tr');

				if (child !== null) {
					const scrollCount = Math.floor(this.$refs.root.clientHeight / child.clientHeight);
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
		 * Get sort indicator for a given column.
		 * @param {number} columnIndex - Index of the column
		 * @returns {string} Sort indicator symbol
		 */
		getSortIndicator: function(columnIndex) {
			if (this.sortColumn !== columnIndex || this.sortDirection === 'off') {
				return '';
			}
			return this.sortDirection === 'asc' ? ' ▲' : ' ▼';
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
							:style="columnStyles['col-' + index] || {}"
							@click="!isOverResizeZone && toggleSort(index)"
							:class="{ sortable: !isOverResizeZone }">
							{{header}}{{getSortIndicator(index)}}
						</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="row in displayItems">
						<td v-for="(field, index) in row" :style="columnStyles['col-' + index] || {}">{{field}}</td>
					</tr>
				</tbody>
			</table>
		</div>
	`
};