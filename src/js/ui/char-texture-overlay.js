/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');

let $overlay;
let $buttons;

const layers = [];
let active_layer = null;

function get_element() {
	if (!$overlay || !$overlay.isConnected) {
		$overlay = document.getElementById('chr-texture-preview');
		$buttons = document.getElementById('chr-overlay-btn');
	}

	return $overlay;
}

function update_button_visibility() {
	if (!$buttons)
		return;

	if (layers.length > 1)
		$buttons.style.display = 'flex';
	else
		$buttons.style.display = 'none';
}

function add(canvas) {
	layers.push(canvas);

	if (active_layer === null) {
		active_layer = canvas;
		get_element().appendChild(canvas);
	}

	update_button_visibility();
}

function remove(canvas) {
	layers.splice(layers.indexOf(canvas), 1);

	if (canvas === active_layer) {
		const element = get_element();
		if (canvas.parentNode === element)
			element.removeChild(canvas);

		active_layer = null;

		if (layers.length > 0)
			active_layer = layers[layers.length - 1];
	}

	update_button_visibility();
}

core.events.on('screen-tab-characters', () => {
	process.nextTick(() => {
		if (active_layer !== null) {
			const element = get_element();
			if (active_layer.parentNode !== element)
				element.appendChild(active_layer);
		}
	});
});

core.events.on('click-chr-next-overlay', () => {
	// Move to the next (or first) layer.
	const index = layers.indexOf(active_layer);
	const next = layers[(index + 1) % layers.length];

	if (next) {
		const element = get_element();

		if (active_layer.parentNode === element)
			element.removeChild(active_layer);

		element.appendChild(next);
		active_layer = next;
	}
});

core.events.on('click-chr-prev-overlay', () => {
	// Move to the previous (or last) layer.
	const index = layers.indexOf(active_layer);
	const next = layers[(index - 1 + layers.length) % layers.length];

	if (next) {
		const element = get_element();

		if (active_layer.parentNode === element)
			element.removeChild(active_layer);

		element.appendChild(next);
		active_layer = next;
	}
});

module.exports = {
	add,
	remove
};