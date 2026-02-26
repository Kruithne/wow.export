/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

export default {
	props: ['value', 'source', 'placeholder', 'maxheight'],
	emits: ['update:value'],

	data: function() {
		return {
			currentText: '',
			isActive: false
		}
	},

	watch: {
		value: function(newValue) {
			if (newValue !== null)
				this.selectOption(this.source.find(item => item.value === newValue.value));
			else
				this.currentText = '';
		}
	},

	mounted: function() {
		if (this.value !== null)
			this.selectOption(this.source.find(item => item.value === this.value.value));
		else
			this.currentText = '';
	},

	computed: {
		filteredSource: function() {
			const currentTextLower = this.currentText.toLowerCase();
			let items = this.source.filter(item => {
				return item.label.toLowerCase().startsWith(currentTextLower);
			});

			if (this.maxheight)
				items = items.slice(0, parseInt(this.maxheight));

			return items;
		}
	},

	methods: {
		selectOption: function(option) {
			if (!option) {
				this.currentText = '';
				this.$emit('update:value', null);
				return;
			}
			
			this.currentText = option.label;
			this.isActive = false;

			if (this.value?.value !== option.value)
				this.$emit('update:value', option);
		},

		onFocus: function() {
			this.isActive = true;
		},

		onBlur: function() {
			// This is delayed because if we click an option, the blur event will fire before the click event.
			setTimeout(() => {
				this.isActive = false;
			}, 200);
		},

		onEnter: function() {
			this.isActive = false;
			const matches = this.filteredSource;
			if (matches.length > 0) {
				this.selectOption(matches[0]);
			} else {
				this.currentText = '';
				this.$emit('update:value', null);
			}
		}
	},

	/** HTML mark-up to render for this component. */
	template: `
		<div class="ui-combobox">
			<input type="text" :placeholder="placeholder" v-model="currentText" @blur="onBlur" @focus="onFocus" ref="field" @keyup.enter="onEnter"/>
			<ul v-if="isActive && currentText.length > 0">
				<li v-for="item in filteredSource" @click="selectOption(item)">{{ item.label }}</li>
			</ul>
		</div>
	`
};