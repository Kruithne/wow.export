/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
export default {
	props: ['value'],

	/**
	 * Invoked when the component is mounted.
	 * Used to create an internal file node.
	 */
	mounted: function() {
		const node = document.createElement('input');
		node.setAttribute('type', 'file');
		node.setAttribute('nwdirectory', 'true');
		node.addEventListener('change', () => {
			this.$el.value = node.value;
			this.$emit('input', node.value);
		});

		this.fileSelector = node;
	},

	/**
	 * Invoked when this component is destroyed.
	 * Used to remove internal references to file node.
	 */
	destroyed: function() {
		this.fileSelector.remove();
	},

	methods: {
		openDialog: function() {
			// Wipe the value here so that it fires after user interaction
			// even if they pick the "same" directory.
			this.fileSelector.value = '';
			this.fileSelector.click();
			this.$el.blur();
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: '<input type="text" :value="value" @focus="openDialog" @input="$emit(\'input\', $event.target.value)"/>'
};