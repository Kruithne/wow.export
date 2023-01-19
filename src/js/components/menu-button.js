/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
Vue.component('menu-button', {
	/**
	 * options: An array of objects with label/value properties.
	 * default: The default value from the options array.
	 * disabled: Controls disabled state of the component.
	 * dropdown: If true, the full button prompts the context menu, not just the arrow.
	 */
	props: ['options', 'default', 'disabled', 'dropdown'],

	data: function() {
		return {
			selectedObj: null, // Currently selected option.
			open: false // If the menu is open or not.
		};
	},

	methods: {
		/**
		 * Set the selected option for this menu button.
		 * @param {object} option
		 */
		select: function(option) {
			this.open = false;
			this.selectedObj = option;
			this.$emit('change', option.value);
		},

		/**
		 * Attempt to open the menu.
		 * Respects component disabled state.
		 */
		openMenu: function() {
			this.open = !this.open && !this.disabled;
		},

		/**
		 * Handle clicks onto the button node.
		 */
		handleClick: function(e) {
			if (this.dropdown)
				this.openMenu();
			else
				this.$emit('click', e);
		}
	},

	computed: {
		/**
		 * Returns the currently selected option or falls back to the default.
		 * @returns {object}
		 */
		selected: function() {
			return this.selectedObj ?? this.defaultObj;
		},

		/**
		 * Returns the option with the same value as the provided default or
		 * falls back to returning the first available option.
		 * @returns {object}
		 */
		defaultObj: function() {
			return this.options.find(e => e.value === this.default) ?? this.options[0];
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-menu-button" :class="{ disabled, dropdown, open }">
		<input type="button" :value="this.selected.label ?? this.selected.value" :class="{ disabled }" @click="handleClick"/>
		<div class="arrow" @click="openMenu"></div>
		<context-menu :node="open" @close="open = false">
			<span v-for="option in options" @click="select(option)">{{ option.label ?? option.value }}</span>
		</context-menu>
	</div>`
});