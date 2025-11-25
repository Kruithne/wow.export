/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const CameraControls = require('../3D/camera/CameraControls');
const CharacterCameraControls = require('../3D/camera/CharacterCameraControls');
const core = require('../core');

module.exports = {
	props: ['context'],

	methods: {
		recreate_controls: function() {
			const canvas = this.renderer.domElement;

			if (this.controls) {
				this.controls.dispose();
				this.controls = null;
			}

			const use_character_controls = this.context.useCharacterControls && !core.view.config.chrUse3DCamera;
			this.controls = use_character_controls
				? new CharacterCameraControls(this.context.camera, canvas, this.context.renderGroup)
				: new CameraControls(this.context.camera, canvas);
			this.context.controls = this.controls;
		},

		render: function() {
			if (!this.isRendering)
				return;

			const currentTime = performance.now() * 0.001;
			if (this.lastTime === undefined)
				this.lastTime = currentTime;

			const deltaTime = currentTime - this.lastTime;
			this.lastTime = currentTime;

			const activeRenderer = this.context.getActiveRenderer?.();
			if (activeRenderer && activeRenderer.updateAnimation)
				activeRenderer.updateAnimation(deltaTime);

			// apply model rotation if speed is non-zero
			const rotation_speed = core.view.modelViewerRotationSpeed;
			if (rotation_speed !== 0)
				this.context.renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), rotation_speed * deltaTime);

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
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, outputColorSpace: THREE.SRGBColorSpace  });

		const canvas = this.renderer.domElement;
		container.appendChild(canvas);

		this.recreate_controls();

		if (this.context.useCharacterControls) {
			this.chr_camera_watcher = core.view.$watch('config.chrUse3DCamera', () => {
				this.recreate_controls();
			});
		}

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
	beforeUnmount: function() {
		this.isRendering = false;
		this.controls.dispose();
		this.renderer.dispose();
		window.removeEventListener('resize', this.onResize);

		if (this.chr_camera_watcher)
			this.chr_camera_watcher();
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="image ui-model-viewer"></div>`
};