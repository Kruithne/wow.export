/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { OrbitControls } from '../3D/lib/OrbitControls';
import * as THREE from 'three';
import { defineComponent } from 'vue';

export default defineComponent({
	props: {
		/** The context to render. */
		'context': {
			type: Object,
			required: true
		}
	},

	/** Invoked when the component is mounted. */
	mounted: function(): void {
		const container = this.$el;
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });

		const canvas = this.renderer.domElement;
		container.appendChild(canvas);

		this.controls = new OrbitControls(this.context.camera, canvas);
		//this.controls.enableKeys = false;
		this.context.controls = this.controls;

		this.onResize = (): void => {
			// We need to remove the canvas from the container so that the layout updates
			// correctly and then we can update the AR/canvas size based on that layout.
			container.removeChild(this.renderer.domElement);

			this.context.camera.aspect = container.clientWidth / container.clientHeight;
			this.context.camera.updateProjectionMatrix();
			this.renderer.setSize(container.clientWidth, container.clientHeight, false);

			// Add the canvas back now that we have the proper measurements applied.
			container.appendChild(this.renderer.domElement);
		};

		this.onResize();
		window.addEventListener('resize', this.onResize);

		this.isRendering = true;
		this.render();
	},

	/**
	 * Invoked when the component is destroyed.
	 */
	beforeUnmount: function(): void {
		this.isRendering = false;
		this.controls.dispose();
		this.renderer.dispose();
		window.removeEventListener('resize', this.onResize);
	},

	methods: {
		render: function(): void {
			if (!this.isRendering)
				return;

			this.controls.update();
			this.renderer.render(this.context.scene, this.context.camera);
			requestAnimationFrame(() => this.render());
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: '<div class="image ui-model-viewer"></div>'
});