/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const ROTATE_SPEED = 0.005;

class CharacterCameraControls {
	constructor(camera, dom_element, render_group) {
		this.camera = camera;
		this.dom_element = dom_element;
		this.render_group = render_group;

		this.target = new THREE.Vector3(0, 0, 0);
		this.is_rotating = false;
		this.prev_mouse_x = 0;

		this.mouse_down_handler = e => this.on_mouse_down(e);
		this.mouse_move_handler = e => this.on_mouse_move(e);
		this.mouse_up_handler = e => this.on_mouse_up(e);

		this.dom_element.addEventListener('mousedown', this.mouse_down_handler);
		this.dom_element.addEventListener('wheel', e => e.preventDefault());
	}

	on_mouse_down(e) {
		if (e.button === 0) {
			this.is_rotating = true;
			this.prev_mouse_x = e.clientX;

			document.addEventListener('mousemove', this.mouse_move_handler);
			document.addEventListener('mouseup', this.mouse_up_handler);

			e.preventDefault();
		}
	}

	on_mouse_move(e) {
		if (this.is_rotating) {
			const delta_x = e.clientX - this.prev_mouse_x;
			this.prev_mouse_x = e.clientX;

			const rotation_delta = delta_x * ROTATE_SPEED;
			this.render_group.rotateOnAxis(new THREE.Vector3(0, 1, 0), rotation_delta);

			e.preventDefault();
		}
	}

	on_mouse_up(e) {
		if (e.button === 0) {
			this.is_rotating = false;

			document.removeEventListener('mousemove', this.mouse_move_handler);
			document.removeEventListener('mouseup', this.mouse_up_handler);
		}
	}

	update() {
		// no-op
	}

	dispose() {
		this.dom_element.removeEventListener('mousedown', this.mouse_down_handler);
		document.removeEventListener('mousemove', this.mouse_move_handler);
		document.removeEventListener('mouseup', this.mouse_up_handler);
	}
}

module.exports = CharacterCameraControls;
