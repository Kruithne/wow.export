/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const CameraControls = require('../3D/camera/CameraControls');

Vue.component('model-viewer', {
	props: ['context'],

	methods: {
		render: function() {
			if (!this.isRendering)
				return;
	
			this.controls.update();
			this.renderer.render(this.context.scene, this.context.camera);
			requestAnimationFrame(() => this.render());
		}
	},

	/**
	 * Invoked when the component is mounted.
	 */
	mounted: function() {
		const container = this.$el;
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, outputColorSpace: THREE.LinearSRGBColorSpace });

		const canvas = this.renderer.domElement;
		container.appendChild(canvas);

		this.controls = new CameraControls(this.context.camera, canvas);
		this.context.controls = this.controls;

		this.onResize = () => {
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
	beforeDestroy: function() {
		this.isRendering = false;
		this.controls.dispose();
		this.renderer.dispose();
		window.removeEventListener('resize', this.onResize);
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="image ui-model-viewer"></div>`
});