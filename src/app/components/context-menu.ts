/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

let clientMouseX = 0;
let clientMouseY = 0;

// Keep a global track of the client mouse position.
window.addEventListener('mousemove', event => {
	clientMouseX = event.clientX;
	clientMouseY = event.clientY;
});

export default {
	/**
	 * node: Object which this context menu represents.
	 */
	props: ['node'],

	data: function() {
		return {
			positionX: 0,
			positionY: 0,
			isLow: false,
			isLeft: false,
		};
	},

	/**
	 * Invoked when this component is about to update.
	 * @see https://vuejs.org/v2/guide/instance.html
	 */
	beforeUpdate: function(): void {
		this.positionX = clientMouseX;
		this.positionY = clientMouseY;
		this.isLow = this.positionY > window.innerHeight / 2;
		this.isLeft = this.positionX > window.innerWidth / 2;
	},

	template: `<div class="context-menu" v-if="node !== null && node !== false" :class=" { low: isLow, left: isLeft }" :style="{ top: positionY + 'px', left: positionX + 'px' }" @mouseleave="$emit('close')" @click="$emit('close')">
		<div class="context-menu-zone"></div>
		<slot v-bind:node="node"></slot>
	</div>
	`
};