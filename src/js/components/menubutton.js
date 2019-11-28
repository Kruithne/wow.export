const util = require('util');

Vue.component('menu-button', {
	/**
	 * options: An array of strings denoting options shown in the menu.
	 * label: Formattable button label. %s is substituted for the selected option.
	 * default: Which option to use as a default.
	 * disabled: Controls disabled state of the component.
	 */
	props: ['options', 'label', 'default', 'disabled'],

	data: function() {
		return {
			selectedOption: '', // Currently selected option.
			open: false // If the menu is open or not.
		}
	},

	methods: {
		/**
		 * Set the selected option for this menu button.
		 * @param {string} option 
		 */
		select: function(option) {
			this.open = false;
			this.selectedOption = option;
			this.$emit('change', option);
		},

		/**
		 * Attempt to open the menu.
		 * Respects component disabled state.
		 */
		openMenu: function() {
			this.open = !this.open && !this.disabled;
		}
	},

	computed: {
		/**
		 * The currently selected option.
		 * Will return default if the selected option is not a valid option.
		 */
		selected: function() {
			if (this.options.includes(this.selectedOption))
				return this.selectedOption;

			return this.default;
		},

		/**
		 * Returns the formatted text to display on the button.
		 */
		displayText: function() {
			return util.format(this.label, this.selected);
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-menu-button" :class="{ disabled }">
		<input type="button" :value="displayText" :class="{ disabled }" @click="$emit('click', $event)"/>
		<div class="arrow" @click="openMenu"></div>
		<ul class="menu" v-if="open">
			<li v-for="option in options" @click="select(option)">{{ option }}</li>
		</ul>
	</div>`
});