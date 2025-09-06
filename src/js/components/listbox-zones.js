/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const listboxComponent = require('./listbox');

module.exports = {
	/**
	 * Extends the base listbox component for zones display.
	 * 
	 * Renders zone entries in the format:
	 * - Expansion icon (always 0 for now)
	 * - Zone Name (Area Name in grey)
	 * - [ID]
	 */
	props: listboxComponent.props,
	emits: listboxComponent.emits,

	data: listboxComponent.data,

	mounted: listboxComponent.mounted,
	beforeUnmount: listboxComponent.beforeUnmount,

	watch: listboxComponent.watch,

	computed: {
		scrollOffset: listboxComponent.computed.scrollOffset,
		scrollIndex: listboxComponent.computed.scrollIndex,
		itemList: listboxComponent.computed.itemList,
		filteredItems: listboxComponent.computed.filteredItems,
		displayItems: listboxComponent.computed.displayItems,
		itemWeight: listboxComponent.computed.itemWeight
	},

	methods: listboxComponent.methods,
	template: listboxComponent.template
};