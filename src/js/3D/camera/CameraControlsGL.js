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
const PAN_SPEED = 1.0;

const KEY_PAN_SPEED = 3;
const KEY_PAN_SPEED_SHIFT = 0.5;
const KEY_PAN_SPEED_ALT = 0.05;

const MIN_POLAR_ANGLE = 0;
const MAX_POLAR_ANGLE = Math.PI;

// vec3 math utilities
const vec3_create = () => [0, 0, 0];
const vec3_copy = (out, a) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; };
const vec3_set = (out, x, y, z) => { out[0] = x; out[1] = y; out[2] = z; return out; };
const vec3_add = (out, a, b) => { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; };
const vec3_sub = (out, a, b) => { out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2]; return out; };
const vec3_scale = (out, a, s) => { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; };
const vec3_length = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const vec3_normalize = (out, a) => {
	const len = vec3_length(a);
	if (len > 0) {
		out[0] = a[0] / len;
		out[1] = a[1] / len;
		out[2] = a[2] / len;
	}
	return out;
};
const vec3_cross = (out, a, b) => {
	const ax = a[0], ay = a[1], az = a[2];
	const bx = b[0], by = b[1], bz = b[2];
	out[0] = ay * bz - az * by;
	out[1] = az * bx - ax * bz;
	out[2] = ax * by - ay * bx;
	return out;
};
const vec3_distance_squared = (a, b) => {
	const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
	return dx * dx + dy * dy + dz * dz;
};

// quat math utilities
const quat_create = () => [0, 0, 0, 1];
const quat_set_from_unit_vectors = (out, from, to) => {
	let r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1;

	if (r < EPS) {
		r = 0;
		if (Math.abs(from[0]) > Math.abs(from[2])) {
			out[0] = -from[1];
			out[1] = from[0];
			out[2] = 0;
			out[3] = r;
		} else {
			out[0] = 0;
			out[1] = -from[2];
			out[2] = from[1];
			out[3] = r;
		}
	} else {
		out[0] = from[1] * to[2] - from[2] * to[1];
		out[1] = from[2] * to[0] - from[0] * to[2];
		out[2] = from[0] * to[1] - from[1] * to[0];
		out[3] = r;
	}

	// normalize
	const len = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3]);
	if (len > 0) {
		out[0] /= len;
		out[1] /= len;
		out[2] /= len;
		out[3] /= len;
	}
	return out;
};

const quat_invert = (out, a) => {
	out[0] = -a[0];
	out[1] = -a[1];
	out[2] = -a[2];
	out[3] = a[3];
	return out;
};

const quat_dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

// apply quaternion to vec3
const vec3_apply_quat = (out, v, q) => {
	const x = v[0], y = v[1], z = v[2];
	const qx = q[0], qy = q[1], qz = q[2], qw = q[3];

	const ix = qw * x + qy * z - qz * y;
	const iy = qw * y + qz * x - qx * z;
	const iz = qw * z + qx * y - qy * x;
	const iw = -qx * x - qy * y - qz * z;

	out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
	out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
	out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
	return out;
};

// spherical coordinates
const spherical_set_from_vec3 = (out, v) => {
	out.radius = vec3_length(v);
	if (out.radius === 0) {
		out.theta = 0;
		out.phi = 0;
	} else {
		out.theta = Math.atan2(v[0], v[2]);
		out.phi = Math.acos(Math.max(-1, Math.min(1, v[1] / out.radius)));
	}
	return out;
};

const vec3_set_from_spherical = (out, s) => {
	const sin_phi = Math.sin(s.phi);
	out[0] = s.radius * sin_phi * Math.sin(s.theta);
	out[1] = s.radius * Math.cos(s.phi);
	out[2] = s.radius * sin_phi * Math.cos(s.theta);
	return out;
};

const spherical_make_safe = (s) => {
	s.phi = Math.max(EPS, Math.min(Math.PI - EPS, s.phi));
	return s;
};

class CameraControlsGL {
	constructor(camera, dom_element) {
		this.camera = camera;
		this.dom_element = dom_element;

		this.target = vec3_create();

		this.state = STATE_NONE;
		this.scale = 1;

		this.pan_offset = vec3_create();

		this.transform_start = vec3_create();
		this.transform_end = vec3_create();
		this.transform_delta = vec3_create();

		this.spherical = { radius: 1, theta: 0, phi: 0 };
		this.spherical_delta = { radius: 0, theta: 0, phi: 0 };

		this.min_distance = 0;
		this.max_distance = Infinity;

		this.offset = vec3_create();

		// quaternion to rotate to y-up space
		const cam_up = camera.up || [0, 1, 0];
		const y_up = [0, 1, 0];
		this.quat = quat_create();
		quat_set_from_unit_vectors(this.quat, cam_up, y_up);
		this.quat_inverse = quat_create();
		quat_invert(this.quat_inverse, this.quat);

		this.last_position = vec3_create();
		this.last_quaternion = quat_create();

		// cached vectors for calculations
		this._cache_cam_dir = vec3_create();
		this._cache_cam_right = vec3_create();
		this._cache_cam_up = vec3_create();

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
				vec3_set(this.transform_start, event.clientX, event.clientY, 0);
				this.state = STATE_PANNING;
			} else {
				vec3_set(this.transform_start, event.clientX, event.clientY, 0);
				this.state = STATE_ROTATING;
			}
		} else if (event.button === MOUSE_BUTTON_RIGHT) {
			vec3_set(this.transform_start, event.clientX, event.clientY, 0);
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
		if (this.state === STATE_NONE)
			return;

		event.preventDefault();

		if (this.state === STATE_ROTATING) {
			vec3_set(this.transform_end, event.clientX, event.clientY, 0);
			vec3_sub(this.transform_delta, this.transform_end, this.transform_start);
			vec3_scale(this.transform_delta, this.transform_delta, ROTATE_SPEED);

			this.rotate_left(2 * Math.PI * this.transform_delta[0] / this.dom_element.clientHeight);
			this.rotate_up(2 * Math.PI * this.transform_delta[1] / this.dom_element.clientHeight);

			vec3_copy(this.transform_start, this.transform_end);
			this.update();
		} else if (this.state === STATE_PANNING) {
			vec3_set(this.transform_end, event.clientX, event.clientY, 0);

			const pan_scale = this.get_pan_scale() * PAN_SPEED;
			vec3_sub(this.transform_delta, this.transform_end, this.transform_start);
			vec3_scale(this.transform_delta, this.transform_delta, pan_scale);
			this.pan(this.transform_delta[0], 0, this.transform_delta[1]);

			vec3_copy(this.transform_start, this.transform_end);
			this.update();
		} else if (this.state === STATE_DOLLYING) {
			vec3_set(this.transform_end, event.clientX, event.clientY, 0);
			vec3_sub(this.transform_delta, this.transform_end, this.transform_start);

			if (this.transform_delta[1] > 0)
				this.dolly_in(ZOOM_SCALE);
			else if (this.transform_delta[1] < 0)
				this.dolly_out(ZOOM_SCALE);

			vec3_copy(this.transform_start, this.transform_end);
			this.update();
		}
	}

	get_pan_scale() {
		const height = this.dom_element.clientHeight || 1;
		const distance = this.spherical.radius;
		const fov = this.camera.fov || 50;
		const v_fov = fov * Math.PI / 180;
		return (2 * Math.tan(v_fov / 2) * distance) / height;
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
		// get camera direction
		const cam_dir = this._cache_cam_dir;
		vec3_sub(cam_dir, this.target, this.camera.position);
		vec3_normalize(cam_dir, cam_dir);

		// get right vector
		const cam_right = this._cache_cam_right;
		const cam_up = this.camera.up || [0, 1, 0];
		vec3_cross(cam_right, cam_dir, cam_up);
		vec3_normalize(cam_right, cam_right);

		// get true up vector
		const true_up = this._cache_cam_up;
		vec3_cross(true_up, cam_right, cam_dir);
		vec3_normalize(true_up, true_up);

		// calculate pan offset
		const pan_right = vec3_create();
		vec3_scale(pan_right, cam_right, -x);

		const pan_up = vec3_create();
		vec3_scale(pan_up, true_up, z);

		const pan_forward = vec3_create();
		vec3_scale(pan_forward, cam_dir, -y);

		vec3_add(this.pan_offset, this.pan_offset, pan_right);
		vec3_add(this.pan_offset, this.pan_offset, pan_up);
		vec3_add(this.pan_offset, this.pan_offset, pan_forward);
	}

	update() {
		vec3_sub(this.offset, this.camera.position, this.target);

		// rotate offset to y-axis-is-up space
		vec3_apply_quat(this.offset, this.offset, this.quat);

		// angle from z-axis around y-axis
		spherical_set_from_vec3(this.spherical, this.offset);

		this.spherical.theta += this.spherical_delta.theta;
		this.spherical.phi += this.spherical_delta.phi;

		// restrict phi to be between desired limits
		this.spherical.phi = Math.max(MIN_POLAR_ANGLE, Math.min(MAX_POLAR_ANGLE, this.spherical.phi));
		spherical_make_safe(this.spherical);

		this.spherical.radius *= this.scale;
		this.spherical.radius = Math.max(this.min_distance, Math.min(this.max_distance, this.spherical.radius));

		// move target to panned location
		vec3_add(this.target, this.target, this.pan_offset);

		vec3_set_from_spherical(this.offset, this.spherical);

		// rotate offset back to camera-up-vector-is-up space
		vec3_apply_quat(this.offset, this.offset, this.quat_inverse);

		vec3_add(this.camera.position, this.target, this.offset);
		this.camera.lookAt(this.target[0], this.target[1], this.target[2]);

		this.spherical_delta.theta = 0;
		this.spherical_delta.phi = 0;
		vec3_set(this.pan_offset, 0, 0, 0);

		this.scale = 1;

		if (vec3_distance_squared(this.last_position, this.camera.position) > EPS ||
			8 * (1 - quat_dot(this.last_quaternion, this.camera.quaternion || [0, 0, 0, 1])) > EPS) {
			vec3_copy(this.last_position, this.camera.position);
			if (this.camera.quaternion)
				this.last_quaternion = [...this.camera.quaternion];

			return true;
		}

		return false;
	}
}

export default CameraControlsGL;