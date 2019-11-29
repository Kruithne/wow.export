Vue.component('slider', {
	/**
	 * value: Slider value between 0 and 1.
	 */
	props: ['value'],

	data: function() {
		return {
			isScrolling: false, // True if the slider is being dragged.
		}
	},

	/**
	 * Invoked when the component is mounted.
	 * Used to register global mouse listeners.
	 */
	mounted: function() {
		this.onMouseMove = e => this.moveMouse(e);
		this.onMouseUp = e => this.stopMouse(e);

		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);
	},

	/**
	 * Invoked when the component is destroyed.
	 * Used to unregister global mouse listeners.
	 */
	beforeDestroy: function() {
		// Unregister global mouse listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
	},

	methods: {
		/**
		 * Invoked when a mouse-down event is captured on the slider handle.
		 * @param {MouseEvent} e 
		 */
		startMouse: function(e) {
			this.scrollStartX = e.clientX
			this.scrollStart = this.value;
			this.isScrolling = true;
		},

		/**
		 * Invoked when a mouse-move event is captured globally.
		 * @param {MouseEvent} e 
		 */
		moveMouse: function(e) {
			if (this.isScrolling) {
				const max = this.$el.clientWidth;
				const delta = e.clientX - this.scrollStartX;
				this.$emit('input', Math.min(1, Math.max(0, this.scrollStart + (delta / max))));
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 * @param {MouseEvent} e 
		 */
		stopMouse: function(e) {
			this.isScrolling = false;
		},
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-slider">
		<div class="fill" :style="{ width: (value * 100) + '%' }"></div>
		<div class="handle" @mousedown="startMouse" :style="{ left: (value * 100) + '%' }"></div>
	</div>`
});