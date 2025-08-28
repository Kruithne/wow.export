/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const MOUSE_BUTTON_LEFT = 0;
const MOUSE_BUTTON_MIDDLE = 1;
const MOUSE_BUTTON_RIGHT = 2;

const STATE_NONE = 0x0;
const STATE_PANNING = 0x1;
const STATE_ROTATING = 0x2;
const STATE_DOLLYING = 0x3;

const KEY_W = 87;
const KEY_S = 83;
const KEY_A = 65;
const KEY_D = 68;
const KEY_Q = 81;
const KEY_E = 69;

const EPS = 0.000001;

const ZOOM_SCALE = 0.95;

const ROTATE_SPEED = 1;
const PAN_SPEED = 0.025;

const KEY_PAN_SPEED = 3;
const KEY_PAN_SPEED_SHIFT = 0.5;
const KEY_PAN_SPEED_ALT = 0.05;

const MIN_POLAR_ANGLE = 0;
const MAX_POLAR_ANGLE = Math.PI;

const CACHE_CAM_DIR = new THREE.Vector3();
const CACHE_CAM_RIGHT = new THREE.Vector3();
const CACHE_CAM_UP = new THREE.Vector3();

class CameraControls {
	constructor(camera, dom_element) {
		this.camera = camera;
		this.dom_element = dom_element;

		this.target = new THREE.Vector3();

		this.state = STATE_NONE;
		this.scale = 1;

		this.pan_offset = new THREE.Vector3();

		this.transform_start = new THREE.Vector3();
		this.transform_end = new THREE.Vector3();
		this.transform_delta = new THREE.Vector3();

		this.spherical = new THREE.Spherical();
		this.spherical_delta = new THREE.Spherical();

		this.min_distance = 0;
		this.max_distance = Infinity;

		this.offset = new THREE.Vector3();

		this.quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
		this.quat_inverse = this.quat.clone().invert();

		this.last_position = new THREE.Vector3();
		this.last_quaternion = new THREE.Quaternion();

		this.init();
	}

	init() {
		this.dom_element.addEventListener('contextmenu', e => e.preventDefault(), false);

		this.dom_element.addEventListener('mousedown', e => this.on_mouse_down(e), false);
		this.dom_element.addEventListener('wheel', e => this.on_mouse_wheel(e), false);

		this.move_listener = e => this.on_mouse_move(e);
		this.up_listener = e => this.on_mouse_up(e);

		document.addEventListener('mousemove', this.move_listener, false);
		document.addEventListener('mouseup', this.up_listener, false);

		this.dom_element.addEventListener('keydown', e => this.on_key_down(e), false);

		if (this.dom_element.tabIndex === -1)
			this.dom_element.tabIndex = 0;
	
		this.update();
	}

	dispose() {
		document.removeEventListener('mousemove', this.move_listener, false);
		document.removeEventListener('mouseup', this.up_listener, false);
	}

	on_mouse_down(event) {
		event.preventDefault();

		this.dom_element.focus ? this.dom_element.focus() : window.focus();

		if (event.button === MOUSE_BUTTON_LEFT || event.button === MOUSE_BUTTON_MIDDLE) {
			if (event.ctrlKey || event.metaKey || event.shiftKey) {
				this.transform_start.set(event.clientX, event.clientY);
				this.state = STATE_PANNING;
			} else {
				this.transform_start.set(event.clientX, event.clientY);
				this.state = STATE_ROTATING;
			}
		} else if (event.button === MOUSE_BUTTON_RIGHT) {
			this.transform_start.set(event.clientX, event.clientY);
			this.state = STATE_PANNING;
		}
	}

	on_mouse_wheel(event) {
		if (this.state !== STATE_NONE && this.state !== STATE_ROTATING)
			return;

		event.preventDefault();
		event.stopPropagation();

		if (event.deltaY < 0)
			this.dolly_out(ZOOM_SCALE);
		else if (event.deltaY > 0)
			this.dolly_in(ZOOM_SCALE);

		this.update();
	}

	on_mouse_move(event) {
		event.preventDefault();

		if (this.state === STATE_ROTATING) {
			this.transform_end.set(event.clientX, event.clientY);
			this.transform_delta.subVectors(this.transform_end, this.transform_start).multiplyScalar(ROTATE_SPEED);

			this.rotate_left(2 * Math.PI * this.transform_delta.x / this.dom_element.clientHeight);
			this.rotate_up(2 * Math.PI * this.transform_delta.y / this.dom_element.clientHeight);

			this.transform_start.copy(this.transform_end);
			this.update();
		} else if (this.state === STATE_PANNING) {
			this.transform_end.set(event.clientX, event.clientY);

			this.transform_delta.subVectors(this.transform_end, this.transform_start).multiplyScalar(PAN_SPEED);
			this.pan(this.transform_delta.x, 0, this.transform_delta.y);

			this.transform_start.copy(this.transform_end);

			this.update();
		} else if (this.state === STATE_DOLLYING) {
			this.transform_end.set(event.clientX, event.clientY);
			this.transform_delta.subVectors(this.transform_end, this.transform_start);

			if (this.transform_delta.y > 0)
				this.dolly_in(ZOOM_SCALE);
			else if (this.transform_delta.y < 0)
				this.dolly_out(ZOOM_SCALE);

			this.transform_start.copy(this.transform_end);
			this.update();
		}
	}

	on_mouse_up() {
		this.state = STATE_NONE;
	}

	on_key_down(event) {
		const key_code = event.keyCode;

		const key_speed = event.shiftKey ? KEY_PAN_SPEED_SHIFT : (event.altKey ? KEY_PAN_SPEED_ALT : KEY_PAN_SPEED);

		if (key_code === KEY_S)
			this.pan(0, key_speed, 0);
		else if (key_code === KEY_W)
			this.pan(0, -key_speed, 0);
		else if (key_code === KEY_A)
			this.pan(key_speed, 0, 0);
		else if (key_code === KEY_D)
			this.pan(-key_speed, 0, 0);
		else if (key_code === KEY_Q)
			this.pan(0, 0, key_speed);
		else if (key_code === KEY_E)
			this.pan(0, 0, -key_speed);
		else
			return;

		event.preventDefault();
		this.update();
	}

	dolly_out(scale) {
		this.scale *= scale;
	}

	dolly_in(scale) {
		this.scale /= scale;
	}

	rotate_left(angle) {
		this.spherical_delta.theta -= angle;
	}

	rotate_up(angle) {
		this.spherical_delta.phi -= angle;
	}

	pan(x, y, z) {
		this.camera.getWorldDirection(CACHE_CAM_DIR);
		CACHE_CAM_RIGHT.crossVectors(CACHE_CAM_DIR, this.camera.up).normalize();
		CACHE_CAM_UP.crossVectors(CACHE_CAM_RIGHT, CACHE_CAM_DIR).normalize();
	
		const pan_right = CACHE_CAM_RIGHT.clone().multiplyScalar(-x);
		const pan_up = CACHE_CAM_UP.clone().multiplyScalar(z);
		const pan_forward = CACHE_CAM_DIR.clone().multiplyScalar(-y);
	
		this.pan_offset.add(pan_right).add(pan_up).add(pan_forward);
	}

	update() {
		this.offset.copy(this.camera.position).sub(this.target);

		// rotate offset to "y-axis-is-up" space
		this.offset.applyQuaternion(this.quat);

		// angle from z-axis around y-axis
		this.spherical.setFromVector3(this.offset);

		this.spherical.theta += this.spherical_delta.theta;
		this.spherical.phi += this.spherical_delta.phi;

		// restrict phi to be between desired limits
		this.spherical.phi = Math.max(MIN_POLAR_ANGLE, Math.min(MAX_POLAR_ANGLE, this.spherical.phi));
		this.spherical.makeSafe();

		this.spherical.radius *= this.scale;
		this.spherical.radius = Math.max(this.min_distance, Math.min(this.max_distance, this.spherical.radius));

		// move target to panned location
		this.target.add(this.pan_offset);

		this.offset.setFromSpherical(this.spherical);

		// rotate offset back to "camera-up-vector-is-up" space
		this.offset.applyQuaternion(this.quat_inverse);

		this.camera.position.copy(this.target).add(this.offset);
		this.camera.lookAt(this.target);

		this.spherical_delta.set(0, 0, 0);
		this.pan_offset.set(0, 0, 0);

		this.scale = 1;

		// min(camera displacement, camera rotation in radians)^2 > EPS
		// using small-angle approximation cos(x/2) = 1 - x^2 / 8
		if (this.last_position.distanceToSquared(this.camera.position) > EPS || 8 * (1 - this.last_quaternion.dot(this.camera.quaternion)) > EPS) {
			this.last_position.copy(this.camera.position);
			this.last_quaternion.copy(this.camera.quaternion);
			this.zoomed_changed = false;

			return true;
		}

		return false;
	}
}

module.exports = CameraControls;