/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const ROTATE_SPEED = 0.005;
const PAN_SPEED = 0.002;
const ZOOM_SCALE = 0.95;
const MIN_DISTANCE = 0.1;
const MAX_DISTANCE = 100;

class CharacterCameraControlsGL {
	constructor(camera, dom_element) {
		this.camera = camera;
		this.dom_element = dom_element;

		this.target = [0, 0, 0];
		this.model_rotation_y = 0;
		this.on_model_rotate = null;

		this.is_rotating = false;
		this.is_panning = false;
		this.prev_mouse_x = 0;
		this.prev_mouse_y = 0;

		this.mouse_down_handler = e => this.on_mouse_down(e);
		this.mouse_move_handler = e => this.on_mouse_move(e);
		this.mouse_up_handler = e => this.on_mouse_up(e);
		this.mouse_wheel_handler = e => this.on_mouse_wheel(e);

		this.dom_element.addEventListener('mousedown', this.mouse_down_handler);
		this.dom_element.addEventListener('wheel', this.mouse_wheel_handler);
		this.dom_element.addEventListener('contextmenu', e => e.preventDefault());
	}

	on_mouse_down(e) {
		if (e.button === 0) {
			this.is_rotating = true;
			this.prev_mouse_x = e.clientX;

			document.addEventListener('mousemove', this.mouse_move_handler);
			document.addEventListener('mouseup', this.mouse_up_handler);

			e.preventDefault();
		} else if (e.button === 2) {
			this.is_panning = true;
			this.prev_mouse_x = e.clientX;
			this.prev_mouse_y = e.clientY;

			document.addEventListener('mousemove', this.mouse_move_handler);
			document.addEventListener('mouseup', this.mouse_up_handler);

			e.preventDefault();
		}
	}

	on_mouse_move(e) {
		if (this.is_rotating) {
			const delta_x = e.clientX - this.prev_mouse_x;
			this.prev_mouse_x = e.clientX;

			this.model_rotation_y += delta_x * ROTATE_SPEED;

			if (this.on_model_rotate)
				this.on_model_rotate(this.model_rotation_y);

			e.preventDefault();
		} else if (this.is_panning) {
			const delta_x = e.clientX - this.prev_mouse_x;
			const delta_y = e.clientY - this.prev_mouse_y;
			this.prev_mouse_x = e.clientX;
			this.prev_mouse_y = e.clientY;

			// get camera vectors
			const px = this.camera.position[0], py = this.camera.position[1], pz = this.camera.position[2];
			const tx = this.target[0], ty = this.target[1], tz = this.target[2];

			// forward
			let fx = tx - px, fy = ty - py, fz = tz - pz;
			const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
			if (fl > 0) { fx /= fl; fy /= fl; fz /= fl; }

			// right = forward x up
			const ux = 0, uy = 1, uz = 0;
			let rx = fy * uz - fz * uy;
			let ry = fz * ux - fx * uz;
			let rz = fx * uy - fy * ux;
			const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
			if (rl > 0) { rx /= rl; ry /= rl; rz /= rl; }

			// up = right x forward
			const nux = ry * fz - rz * fy;
			const nuy = rz * fx - rx * fz;
			const nuz = rx * fy - ry * fx;

			const distance = fl;
			const pan_scale = distance * PAN_SPEED;

			// apply pan
			const offset_x = -delta_x * pan_scale * rx + delta_y * pan_scale * nux;
			const offset_y = -delta_x * pan_scale * ry + delta_y * pan_scale * nuy;
			const offset_z = -delta_x * pan_scale * rz + delta_y * pan_scale * nuz;

			this.camera.position[0] += offset_x;
			this.camera.position[1] += offset_y;
			this.camera.position[2] += offset_z;
			this.target[0] += offset_x;
			this.target[1] += offset_y;
			this.target[2] += offset_z;

			this.camera.lookAt(this.target[0], this.target[1], this.target[2]);

			e.preventDefault();
		}
	}

	on_mouse_up(e) {
		if (e.button === 0) {
			this.is_rotating = false;

			document.removeEventListener('mousemove', this.mouse_move_handler);
			document.removeEventListener('mouseup', this.mouse_up_handler);
		} else if (e.button === 2) {
			this.is_panning = false;

			document.removeEventListener('mousemove', this.mouse_move_handler);
			document.removeEventListener('mouseup', this.mouse_up_handler);
		}
	}

	on_mouse_wheel(e) {
		e.preventDefault();
		e.stopPropagation();

		const px = this.camera.position[0], py = this.camera.position[1], pz = this.camera.position[2];
		const tx = this.target[0], ty = this.target[1], tz = this.target[2];

		const dx = px - tx, dy = py - ty, dz = pz - tz;
		const current_distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

		let zoom_amount;
		if (e.deltaY < 0)
			zoom_amount = current_distance * (1 - ZOOM_SCALE);
		else if (e.deltaY > 0)
			zoom_amount = -current_distance * (1 - ZOOM_SCALE);
		else
			return;

		const new_distance = current_distance - zoom_amount;

		if (new_distance >= MIN_DISTANCE && new_distance <= MAX_DISTANCE) {
			// normalize direction
			const dir_x = dx / current_distance;
			const dir_y = dy / current_distance;
			const dir_z = dz / current_distance;

			this.camera.position[0] -= dir_x * zoom_amount;
			this.camera.position[1] -= dir_y * zoom_amount;
			this.camera.position[2] -= dir_z * zoom_amount;

			this.camera.update_view();
		}
	}

	update() {
		// no-op for compatibility
	}

	dispose() {
		this.dom_element.removeEventListener('mousedown', this.mouse_down_handler);
		this.dom_element.removeEventListener('wheel', this.mouse_wheel_handler);
		document.removeEventListener('mousemove', this.mouse_move_handler);
		document.removeEventListener('mouseup', this.mouse_up_handler);
	}
}

module.exports = CharacterCameraControlsGL;
