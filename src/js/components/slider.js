/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
export default {
	/**
	 * value: Slider value between 0 and 1.
	 */
	props: ['modelValue'],
	emits: ['update:modelValue'],

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
	beforeUnmount: function() {
		// Unregister global mouse listeners.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);
	},

	methods: {
		/**
		 * Set the current value of this slider.
		 * @param {number} value 
		 */
		setValue: function(value) {
			this.$emit('update:modelValue', Math.min(1, Math.max(0, value)));
		},

		/**
		 * Invoked when a mouse-down event is captured on the slider handle.
		 * @param {MouseEvent} e 
		 */
		startMouse: function(e) {
			this.scrollStartX = e.clientX
			this.scrollStart = this.modelValue;
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
				this.setValue(this.scrollStart + (delta / max));
			}
		},

		/**
		 * Invoked when a mouse-up event is captured globally.
		 */
		stopMouse: function() {
			this.isScrolling = false;
		},

		/**
		 * Invoked when the user clicks somewhere on the slider.
		 * @param {MouseEvent} e 
		 */
		handleClick: function(e) {
			// Don't handle click events on the draggable handle.
			if (e.target === this.$refs.handle)
				return;

			this.setValue(e.offsetX / this.$el.clientWidth);
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-slider" @click="handleClick">
		<div class="fill" :style="{ width: (modelValue * 100) + '%' }"></div>
		<div class="handle" ref="handle" @mousedown="startMouse" :style="{ left: (modelValue * 100) + '%' }"></div>
	</div>`
};