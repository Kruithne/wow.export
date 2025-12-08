/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const core = require('../core');
const GLContext = require('../3D/gl/GLContext');
const CameraControlsGL = require('../3D/camera/CameraControlsGL');
const CharacterCameraControlsGL = require('../3D/camera/CharacterCameraControlsGL');
const GridRenderer = require('../3D/renderers/GridRenderer');
const ShadowPlaneRenderer = require('../3D/renderers/ShadowPlaneRenderer');

const parse_hex_color = (hex) => {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!result)
		return [0, 0, 0];

	return [
		parseInt(result[1], 16) / 255,
		parseInt(result[2], 16) / 255,
		parseInt(result[3], 16) / 255
	];
};

// general model camera fit constants
const CAMERA_FIT_DIAGONAL_ANGLE = 45;
const CAMERA_FIT_DISTANCE_MULTIPLIER = 2;
const CAMERA_FIT_ELEVATION_FACTOR = 0.3;
const CAMERA_FIT_CENTER_OFFSET_Y = -0.5;

// simple perspective camera implementation
class PerspectiveCamera {
	constructor(fov, aspect, near, far) {
		this.fov = fov;
		this.aspect = aspect;
		this.near = near;
		this.far = far;

		this.position = [0, 0, 5];
		this.target = [0, 0, 0];
		this.up = [0, 1, 0];

		this.view_matrix = new Float32Array(16);
		this.projection_matrix = new Float32Array(16);

		this.update_projection();
		this.update_view();
	}

	update_projection() {
		const f = 1.0 / Math.tan(this.fov * 0.5 * Math.PI / 180);
		const nf = 1 / (this.near - this.far);

		this.projection_matrix[0] = f / this.aspect;
		this.projection_matrix[1] = 0;
		this.projection_matrix[2] = 0;
		this.projection_matrix[3] = 0;
		this.projection_matrix[4] = 0;
		this.projection_matrix[5] = f;
		this.projection_matrix[6] = 0;
		this.projection_matrix[7] = 0;
		this.projection_matrix[8] = 0;
		this.projection_matrix[9] = 0;
		this.projection_matrix[10] = (this.far + this.near) * nf;
		this.projection_matrix[11] = -1;
		this.projection_matrix[12] = 0;
		this.projection_matrix[13] = 0;
		this.projection_matrix[14] = 2 * this.far * this.near * nf;
		this.projection_matrix[15] = 0;
	}

	update_view() {
		const px = this.position[0], py = this.position[1], pz = this.position[2];
		const tx = this.target[0], ty = this.target[1], tz = this.target[2];
		const ux = this.up[0], uy = this.up[1], uz = this.up[2];

		// forward
		let fx = px - tx, fy = py - ty, fz = pz - tz;
		let fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
		if (fl > 0) { fx /= fl; fy /= fl; fz /= fl; }

		// right = up x forward
		let rx = uy * fz - uz * fy;
		let ry = uz * fx - ux * fz;
		let rz = ux * fy - uy * fx;
		let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
		if (rl > 0) { rx /= rl; ry /= rl; rz /= rl; }

		// up = forward x right
		const nux = fy * rz - fz * ry;
		const nuy = fz * rx - fx * rz;
		const nuz = fx * ry - fy * rx;

		this.view_matrix[0] = rx;
		this.view_matrix[1] = nux;
		this.view_matrix[2] = fx;
		this.view_matrix[3] = 0;
		this.view_matrix[4] = ry;
		this.view_matrix[5] = nuy;
		this.view_matrix[6] = fy;
		this.view_matrix[7] = 0;
		this.view_matrix[8] = rz;
		this.view_matrix[9] = nuz;
		this.view_matrix[10] = fz;
		this.view_matrix[11] = 0;
		this.view_matrix[12] = -(rx * px + ry * py + rz * pz);
		this.view_matrix[13] = -(nux * px + nuy * py + nuz * pz);
		this.view_matrix[14] = -(fx * px + fy * py + fz * pz);
		this.view_matrix[15] = 1;
	}

	lookAt(x, y, z) {
		this.target[0] = x;
		this.target[1] = y;
		this.target[2] = z;
		this.update_view();
	}

	setPosition(x, y, z) {
		this.position[0] = x;
		this.position[1] = y;
		this.position[2] = z;
		this.update_view();
	}
}

/**
 * Fit camera to bounding box using diagonal view approach
 * @param {{ min: number[], max: number[] }} bounding_box
 * @param {PerspectiveCamera} camera
 * @param {CameraControlsGL} controls
 */
function fit_camera_to_bounding_box(bounding_box, camera, controls) {
	if (!bounding_box)
		return;

	const min = bounding_box.min;
	const max = bounding_box.max;

	// calculate center with offset
	const center_x = (min[0] + max[0]) / 2;
	const center_y = (min[1] + max[1]) / 2 + CAMERA_FIT_CENTER_OFFSET_Y;
	const center_z = (min[2] + max[2]) / 2;

	// calculate dimensions and max dimension
	const size_x = max[0] - min[0];
	const size_y = max[1] - min[1];
	const size_z = max[2] - min[2];
	const max_dimension = Math.max(size_x, size_y, size_z);

	// calculate required distance based on camera FOV and object size
	const fov_radians = camera.fov * (Math.PI / 180);
	const distance = (max_dimension / 2) / Math.tan(fov_radians / 2) * CAMERA_FIT_DISTANCE_MULTIPLIER;

	// calculate camera position at diagonal angle with elevation
	const angle_rad = CAMERA_FIT_DIAGONAL_ANGLE * (Math.PI / 180);

	const offset_x = distance * Math.sin(angle_rad);
	const offset_y = distance * CAMERA_FIT_ELEVATION_FACTOR;
	const offset_z = distance * Math.cos(angle_rad);

	// position camera
	camera.position[0] = center_x + offset_x;
	camera.position[1] = center_y + offset_y;
	camera.position[2] = center_z + offset_z;
	camera.lookAt(center_x, center_y, center_z);

	// update controls target
	if (controls) {
		controls.target[0] = center_x;
		controls.target[1] = center_y;
		controls.target[2] = center_z;

		controls.max_distance = distance * 3;
		controls.update();
	}
}

/**
 * Fit camera for character view - fixed position tuned for humanoid models
 * @param {PerspectiveCamera} camera
 * @param {CameraControlsGL|CharacterCameraControlsGL} controls
 */
function fit_camera_for_character(bounding_box, camera, controls) {
	camera.position[0] = 0;
	camera.position[1] = 1.609;
	camera.position[2] = 2.347;

	const target_x = 0;
	const target_y = 1.247;
	const target_z = 0.537;

	camera.lookAt(target_x, target_y, target_z);

	if (controls) {
		controls.target[0] = target_x;
		controls.target[1] = target_y;
		controls.target[2] = target_z;

		if (controls.update)
			controls.update();
	}
}

module.exports = {
	props: ['context'],

	methods: {
		render: function() {
			if (!this.isRendering)
				return;

			const currentTime = performance.now() * 0.001;
			if (this.lastTime === undefined)
				this.lastTime = currentTime;

			const deltaTime = currentTime - this.lastTime;
			this.lastTime = currentTime;

			// update animation
			const activeRenderer = this.context.getActiveRenderer?.();
			if (activeRenderer && activeRenderer.updateAnimation) {
				activeRenderer.updateAnimation(deltaTime);

				// update frame counter in view (throttled to ~15fps for UI updates)
				if (activeRenderer.get_animation_frame && !activeRenderer.animation_paused) {
					this.frameUpdateCounter = (this.frameUpdateCounter || 0) + 1;
					if (this.frameUpdateCounter >= 4) {
						this.frameUpdateCounter = 0;
						const frame_key = this.context.useCharacterControls ? 'chrModelViewerAnimFrame' : 'modelViewerAnimFrame';
						core.view[frame_key] = activeRenderer.get_animation_frame();
					}
				}
			}

			// apply model rotation if speed is non-zero (non-character mode)
			const rotation_speed = core.view.modelViewerRotationSpeed;
			if (rotation_speed !== 0 && activeRenderer && activeRenderer.setTransform && !this.use_character_controls) {
				this.model_rotation_y += rotation_speed * deltaTime;
				activeRenderer.setTransform(
					[0, 0, 0],
					[0, this.model_rotation_y, 0],
					[1, 1, 1]
				);
			}

			// update controls
			this.controls.update();

			// clear with appropriate background
			const is_chr = this.context.useCharacterControls;
			const show_bg = is_chr ? core.view.config.chrShowBackground : core.view.config.modelViewerShowBackground;
			const bg_color = is_chr ? core.view.config.chrBackgroundColor : core.view.config.modelViewerBackgroundColor;

			if (show_bg) {
				const [r, g, b] = parse_hex_color(bg_color);
				this.gl_context.set_clear_color(r, g, b, 1);
			} else {
				this.gl_context.set_clear_color(0, 0, 0, 0);
			}
			this.gl_context.clear(true, true);

			// render shadow plane (before model, for character mode)
			if (this.shadow_renderer && this.shadow_renderer.visible)
				this.shadow_renderer.render(this.camera.view_matrix, this.camera.projection_matrix);

			// render grid (not in character mode)
			if (core.view.config.modelViewerShowGrid && this.grid_renderer && !this.context.useCharacterControls)
				this.grid_renderer.render(this.camera.view_matrix, this.camera.projection_matrix);

			// render model
			if (activeRenderer && activeRenderer.render)
				activeRenderer.render(this.camera.view_matrix, this.camera.projection_matrix);

			// render equipment models at attachment points (character mode only)
			const equipment_renderers = this.context.getEquipmentRenderers?.();
			if (equipment_renderers && activeRenderer) {
				for (const slot_entry of equipment_renderers.values()) {
					if (!slot_entry?.renderers)
						continue;

					for (const { renderer, attachment_id } of slot_entry.renderers) {
						if (!renderer?.render)
							continue;

						// get attachment transform from character model
						if (attachment_id !== undefined) {
							const attach_transform = activeRenderer.getAttachmentTransform?.(attachment_id);
							if (attach_transform)
								renderer.setTransformMatrix(attach_transform);
						}

						renderer.render(this.camera.view_matrix, this.camera.projection_matrix);
					}
				}
			}

			requestAnimationFrame(() => this.render());
		},

		recreate_controls: function() {
			if (this.controls) {
				this.controls.dispose();
				this.controls = null;
			}

			const use_3d_camera = this.context.useCharacterControls ? core.view.config.chrUse3DCamera : true;

			if (this.context.useCharacterControls && !use_3d_camera) {
				this.controls = new CharacterCameraControlsGL(this.camera, this.canvas);
				this.controls.on_model_rotate = (rotation_y) => {
					const active_renderer = this.context.getActiveRenderer?.();
					if (active_renderer && active_renderer.setTransform)
						active_renderer.setTransform([0, 0, 0], [0, rotation_y, 0], [1, 1, 1]);
				};

				// initial 90 degree clockwise rotation
				this.controls.model_rotation_y = -Math.PI / 2;
				this.controls.on_model_rotate(this.controls.model_rotation_y);

				this.use_character_controls = true;
			} else {
				this.controls = new CameraControlsGL(this.camera, this.canvas);
				this.use_character_controls = false;
			}

			this.context.controls = this.controls;
		},

		update_shadow_visibility: function() {
			if (!this.shadow_renderer)
				return;

			const should_show = this.context.useCharacterControls &&
				core.view.config.chrRenderShadow &&
				!core.view.chrModelLoading;

			this.shadow_renderer.visible = should_show;
		},

		fit_camera: function() {
			const active_renderer = this.context.getActiveRenderer?.();
			if (!active_renderer || !active_renderer.getBoundingBox)
				return;

			const bounding_box = active_renderer.getBoundingBox();
			if (!bounding_box)
				return;

			if (this.context.useCharacterControls)
				fit_camera_for_character(bounding_box, this.camera, this.controls);
			else
				fit_camera_to_bounding_box(bounding_box, this.camera, this.controls);
		}
	},

	mounted: function() {
		const container = this.$el;

		// create canvas
		const canvas = document.createElement('canvas');
		canvas.className = 'gl-canvas';
		container.appendChild(canvas);
		this.canvas = canvas;

		// create GL context
		this.gl_context = new GLContext(canvas, {
			antialias: true,
			alpha: true,
			preserveDrawingBuffer: true
		});

		// store context for renderers
		this.context.gl_context = this.gl_context;

		// create camera
		this.camera = new PerspectiveCamera(70, 1, 0.01, 2000);

		// model rotation
		this.model_rotation_y = 0;
		this.use_character_controls = false;

		// create controls
		this.recreate_controls();

		// expose fit_camera on context
		this.context.fitCamera = () => this.fit_camera();

		// create grid renderer
		this.grid_renderer = new GridRenderer(this.gl_context, 100, 100);

		// create shadow renderer (for character mode)
		this.shadow_renderer = new ShadowPlaneRenderer(this.gl_context, 2);
		this.shadow_renderer.visible = false;
		this.update_shadow_visibility();

		// watchers for character mode
		this.watchers = [];

		if (this.context.useCharacterControls) {
			this.watchers.push(
				core.view.$watch('config.chrUse3DCamera', () => this.recreate_controls()),
				core.view.$watch('config.chrRenderShadow', () => this.update_shadow_visibility()),
				core.view.$watch('chrModelLoading', () => this.update_shadow_visibility())
			);
		}

		// resize handler
		this.onResize = () => {
			const rect = container.getBoundingClientRect();
			const width = rect.width;
			const height = rect.height;

			canvas.width = width * window.devicePixelRatio;
			canvas.height = height * window.devicePixelRatio;
			canvas.style.width = width + 'px';
			canvas.style.height = height + 'px';

			this.gl_context.set_viewport(canvas.width, canvas.height);

			this.camera.aspect = width / height;
			this.camera.update_projection();
		};

		this.onResize();
		window.addEventListener('resize', this.onResize);

		// start render loop
		this.isRendering = true;
		this.render();
	},

	beforeUnmount: function() {
		this.isRendering = false;
		this.controls.dispose();
		this.grid_renderer.dispose();
		this.shadow_renderer?.dispose();
		this.gl_context.dispose();
		window.removeEventListener('resize', this.onResize);

		for (const watcher of this.watchers)
			watcher();

		this.watchers = [];
	},

	template: `<div class="image ui-model-viewer"></div>`
};
