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
const { ATTACHMENT_ID } = require('../wow/EquipmentSlots');

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

/**
 * Scan a 2D context for the bounding box of pixels above an alpha threshold,
 * used to crop a transparent capture down to just the rendered model.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @returns {{ min_x: number, min_y: number, max_x: number, max_y: number }|null}
 */
function find_opaque_bounds(ctx, w, h) {
	const data = ctx.getImageData(0, 0, w, h).data;
	const ALPHA = 10;

	let min_x = w, min_y = h, max_x = -1, max_y = -1;

	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3] > ALPHA) {
				if (x < min_x) min_x = x;
				if (x > max_x) max_x = x;
				if (y < min_y) min_y = y;
				if (y > max_y) max_y = y;
			}
		}
	}

	if (max_x < 0)
		return null;

	return { min_x, min_y, max_x, max_y };
}

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

			// enforce character model orientation every frame. the rotation is
			// otherwise only pushed via the controls callback, which a freshly
			// loaded renderer can miss (load-order race) - leaving the model
			// misaligned with the fixed light so it appears lit from behind.
			// applying it here is idempotent and covers every ordering.
			if (this.context.useCharacterControls && activeRenderer?.setTransform) {
				if (typeof this.controls.model_rotation_y === 'number')
					this.last_chr_rotation = this.controls.model_rotation_y;

				activeRenderer.setTransform([0, 0, 0], [0, this.last_chr_rotation ?? -Math.PI / 2, 0], [1, 1, 1]);
			}

			this.draw_scene();

			requestAnimationFrame(() => this.render());
		},

		// Draws the current scene to the bound canvas at its current backing
		// resolution. Separated from render() so it can be reused for off-cycle
		// high-resolution captures without disturbing the animation loop.
		draw_scene: function() {
			const activeRenderer = this.context.getActiveRenderer?.();

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

			// render equipment models at attachment points (character mode only)
			const equipment_renderers = this.context.getEquipmentRenderers?.();

			// determine hand grip state based on equipped weapons
			if (activeRenderer && equipment_renderers && activeRenderer.setHandGrip) {
				let close_right = false;
				let close_left = false;

				// check main-hand (slot 16) and off-hand (slot 17)
				const mainhand = equipment_renderers.get(16);
				const offhand = equipment_renderers.get(17);

				if (mainhand?.renderers?.length > 0) {
					// bows use left-hand attachment despite being main-hand items
					const uses_left_hand = mainhand.renderers.some(r => r.attachment_id === ATTACHMENT_ID.HAND_LEFT);
					if (uses_left_hand)
						close_left = true;
					else
						close_right = true;
				}

				if (offhand?.renderers?.length > 0) {
					// shields don't require grip (attached to wrist)
					const has_shield = offhand.renderers.some(r => r.attachment_id === ATTACHMENT_ID.SHIELD);
					if (!has_shield)
						close_left = true;
				}

				activeRenderer.setHandGrip(close_right, close_left);
			}

			// render model
			if (activeRenderer && activeRenderer.render)
				activeRenderer.render(this.camera.view_matrix, this.camera.projection_matrix);

			if (equipment_renderers && activeRenderer) {
				const char_bone_matrices = activeRenderer.bone_matrices;
				const char_model_matrix = activeRenderer.model_matrix;

				for (const slot_entry of equipment_renderers.values()) {
					if (!slot_entry?.renderers)
						continue;

					for (const { renderer, attachment_id, is_collection_style } of slot_entry.renderers) {
						if (!renderer?.render)
							continue;

						// collection-style models (e.g. backpacks) need bone matrix remapping
						if (is_collection_style) {
							if (char_bone_matrices && renderer.applyExternalBoneMatrices)
								renderer.applyExternalBoneMatrices(char_bone_matrices);

							if (char_model_matrix)
								renderer.setTransformMatrix(char_model_matrix);
						} else if (attachment_id !== undefined) {
							// regular attachment models use attachment transform
							const attach_transform = activeRenderer.getAttachmentTransform?.(attachment_id);
							if (attach_transform)
								renderer.setTransformMatrix(attach_transform);
						}

						renderer.render(this.camera.view_matrix, this.camera.projection_matrix);
					}
				}
			}

			// render collection models with remapped bone matrices
			const collection_renderers = this.context.getCollectionRenderers?.();
			if (collection_renderers && activeRenderer) {
				const char_bone_matrices = activeRenderer.bone_matrices;
				const char_model_matrix = activeRenderer.model_matrix;

				for (const slot_entry of collection_renderers.values()) {
					if (!slot_entry?.renderers)
						continue;

					for (const renderer of slot_entry.renderers) {
						if (!renderer?.render)
							continue;

						// apply remapped bone matrices for proper rigging
						if (char_bone_matrices && renderer.applyExternalBoneMatrices)
							renderer.applyExternalBoneMatrices(char_bone_matrices);

						// use character's model transform (rotation from controls)
						if (char_model_matrix)
							renderer.setTransformMatrix(char_model_matrix);

						renderer.render(this.camera.view_matrix, this.camera.projection_matrix);
					}
				}
			}

			// render external customization models (DH horns, dracthyr, mechagnome upgrades)
			const skinned_renderers = this.context.getSkinnedRenderers?.();
			if (skinned_renderers && activeRenderer) {
				const char_bone_matrices = activeRenderer.bone_matrices;
				const char_model_matrix = activeRenderer.model_matrix;

				for (const entry of skinned_renderers.values()) {
					const renderer = entry?.renderer;
					if (!renderer?.render)
						continue;

					// share character skeleton + world transform
					if (char_bone_matrices && renderer.applyExternalBoneMatrices)
						renderer.applyExternalBoneMatrices(char_bone_matrices);

					if (char_model_matrix)
						renderer.setTransformMatrix(char_model_matrix);

					renderer.render(this.camera.view_matrix, this.camera.projection_matrix);
				}
			}
		},

		// Render the scene at a multiple of the current resolution and return a
		// transparent PNG data URL. Runs synchronously (resize -> draw -> read ->
		// restore) so the browser never paints the upscaled buffer (no flicker).
		// By default the result is cropped to the model's opaque bounds so the
		// subject fills the frame instead of wasting resolution on empty space.
		capture_high_res: function(scale) {
			const canvas = this.canvas;

			const prev_w = canvas.width;
			const prev_h = canvas.height;

			// clamp the multiplier and keep within a safe maximum dimension so we
			// never exceed GL/canvas limits on large windows.
			const MAX_DIM = 8192;
			let factor = Math.max(1, Math.min(scale || 1, 4));
			factor = Math.max(1, Math.min(factor, MAX_DIM / prev_w, MAX_DIM / prev_h));

			const cap_w = Math.max(1, Math.round(prev_w * factor));
			const cap_h = Math.max(1, Math.round(prev_h * factor));

			try {
				canvas.width = cap_w;
				canvas.height = cap_h;
				this.gl_context.set_viewport(cap_w, cap_h);

				this.draw_scene();

				// Copy into a 2D canvas: the source is a WebGL canvas, so reading
				// pixels (for cropping) requires a 2D context.
				const tmp = document.createElement('canvas');
				tmp.width = cap_w;
				tmp.height = cap_h;
				const tctx = tmp.getContext('2d');
				tctx.drawImage(canvas, 0, 0);

				// When the background is opaque we can't crop; return as-is.
				const should_crop = core.view.config.previewExportCrop !== false;
				const bounds = should_crop ? find_opaque_bounds(tctx, cap_w, cap_h) : null;
				if (!bounds)
					return tmp.toDataURL('image/png');

				// add a little breathing room around the model
				const pad = Math.round(Math.max(cap_w, cap_h) * 0.02);
				const x0 = Math.max(0, bounds.min_x - pad);
				const y0 = Math.max(0, bounds.min_y - pad);
				const x1 = Math.min(cap_w - 1, bounds.max_x + pad);
				const y1 = Math.min(cap_h - 1, bounds.max_y + pad);

				const out_w = x1 - x0 + 1;
				const out_h = y1 - y0 + 1;

				const out = document.createElement('canvas');
				out.width = out_w;
				out.height = out_h;
				out.getContext('2d').drawImage(tmp, x0, y0, out_w, out_h, 0, 0, out_w, out_h);

				return out.toDataURL('image/png');
			} finally {
				canvas.width = prev_w;
				canvas.height = prev_h;
				this.gl_context.set_viewport(prev_w, prev_h);
				this.draw_scene();
			}
		},

		recreate_controls: function() {
			if (this.controls) {
				this.controls.dispose();
				this.controls = null;
			}

			const use_3d_camera = this.context.useCharacterControls ? core.view.config.chrUse3DCamera : core.view.config.modelViewerUse3DCamera !== false;

			if (!use_3d_camera) {
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

			const config = core.view.config;
			const should_show = this.context.useCharacterControls
				? (config.chrRenderShadow && !core.view.chrModelLoading)
				: !!config.modelViewerShowShadow;

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

		// Expose a high-resolution capture on the canvas so export code (which
		// already has the canvas element) can produce supersampled screenshots.
		canvas.captureHighRes = (scale) => this.capture_high_res(scale);

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

		// last known character model rotation; used to keep the model oriented
		// even when the active controls don't track model rotation (3D camera)
		this.last_chr_rotation = -Math.PI / 2;

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
		} else {
			this.watchers.push(
				core.view.$watch('config.modelViewerUse3DCamera', () => this.recreate_controls()),
				core.view.$watch('config.modelViewerShowShadow', () => this.update_shadow_visibility())
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
