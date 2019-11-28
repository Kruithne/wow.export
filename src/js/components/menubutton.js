const util = require('util');

Vue.component('menu-button', {
	props: ['options', 'label', 'default'],

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

	template: `<div class="ui-menu-button">
		<input type="button" :value="displayText"/>
		<div class="arrow" @click="open = !open"></div>
		<ul class="menu" v-if="open">
			<li v-for="option in options" @click="select(option)">{{ option }}</li>
		</ul>
	</div>`
});