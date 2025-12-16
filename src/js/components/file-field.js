/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
module.exports = {
	props: ['modelValue', 'placeholder'],
	emits: ['update:modelValue'],

	/**
	 * Invoked when the component is mounted.
	 * Used to create an internal file node.
	 */
	mounted: function() {
		const node = document.createElement('input');
		node.setAttribute('type', 'file');
		node.setAttribute('nwdirectory', true);
		node.addEventListener('change', () => {
			this.$emit('update:modelValue', node.value);
		});

		this.fileSelector = node;
	},

	/**
	 * Invoked when this component is unmounted.
	 * Used to remove internal references to file node.
	 */
	unmounted: function() {
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
	template: `<input type="text" :value="modelValue" :placeholder="placeholder" @focus="openDialog" @input="$emit('update:modelValue', $event.target.value)"/>`
};