/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
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
	beforeDestroy: function() {
		this.observer.disconnect();
	},

	template: '<div><slot></slot></div>'
};