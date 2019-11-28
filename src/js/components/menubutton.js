const util = require('util');

Vue.component('menu-button', {
	props: ['options', 'label', 'default', 'disabled'],

	data: function() {
		return {
			selectedOption: '',
			open: false
		}
	},

	methods: {
		select: function(option) {
			this.open = false;
			this.selectedOption = option;
			this.$emit('change', option);
		},

		openMenu: function() {
			this.open = !this.open && !this.disabled;
		}
	},

	computed: {
		selected: function() {
			if (this.options.includes(this.selectedOption))
				return this.selectedOption;

			return this.default;
		},

		displayText: function() {
			return util.format(this.label, this.selected);
		}
	},

	template: `<div class="ui-menu-button" :class="{ disabled }">
		<input type="button" :value="displayText" :class="{ disabled }" @click="$emit('click', $event)"/>
		<div class="arrow" @click="openMenu"></div>
		<ul class="menu" v-if="open">
			<li v-for="option in options" @click="select(option)">{{ option }}</li>
		</ul>
	</div>`
});