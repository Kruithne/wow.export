/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
export default {
	/**
	 * Invoked when this component is mounted.
	 * @see https://vuejs.org/v2/guide/instance.html
	 * 
	 */
	mounted: function() {
		this.observer = new ResizeObserver(() => this.$emit('resize', this.$el.clientWidth));
		this.observer.observe(this.$el);
	},

	/**
	 * Invoked before this component is destroyed.
	 * @see https://vuejs.org/v2/guide/instance.html
	 */
	beforeUnmount: function() {
		this.observer.disconnect();
	},

	template: `<div><slot></slot></div>`
};