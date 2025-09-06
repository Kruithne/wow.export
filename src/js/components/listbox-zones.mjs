/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

import listboxComponent from './listbox.mjs';

export default {
	/**
	 * Extends the base listbox component with expansion filtering for zones.
	 * 
	 * Additional props:
	 * expansionFilter: Reactive value for filtering by expansion ID (-1 for all, 0+ for specific expansion)
	 */
	props: [...listboxComponent.props, 'expansionFilter'],
	emits: listboxComponent.emits,

	data: listboxComponent.data,

	mounted: listboxComponent.mounted,
	beforeUnmount: listboxComponent.beforeUnmount,

	watch: {
		...listboxComponent.watch,
		
		expansionFilter: function() {
			this.scroll = 0;
			this.scrollRel = 0;
			this.recalculateBounds();
		}
	},

	computed: {
		scrollOffset: listboxComponent.computed.scrollOffset,
		scrollIndex: listboxComponent.computed.scrollIndex,
		itemList: listboxComponent.computed.itemList,

		/**
		 * Reactively filtered version of the underlying data array.
		 * Applies both text filtering and expansion filtering.
		 */
		filteredItems: function() {
			let res = this.itemList;

			// First apply expansion filtering if set
			if (this.expansionFilter !== undefined && this.expansionFilter !== -1) {
				res = res.filter(item => {
					// Extract expansion ID from the zone entry format
					const parts = item.split('\x19');
					if (parts.length >= 1) {
						const expansionId = parseInt(parts[0]);
						return expansionId === this.expansionFilter;
					}
					return false;
				});
			}

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

		displayItems: listboxComponent.computed.displayItems,
		itemWeight: listboxComponent.computed.itemWeight
	},

	methods: listboxComponent.methods,
	template: listboxComponent.template
}