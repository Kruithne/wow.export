const constants = require('../constants');

const GLYPH_RANGES = [
	{ start: 0x0020, end: 0x007F, name: 'Basic Latin' },
	{ start: 0x00A0, end: 0x00FF, name: 'Latin-1 Supplement' },
	{ start: 0x0100, end: 0x017F, name: 'Latin Extended-A' },
	{ start: 0x0180, end: 0x024F, name: 'Latin Extended-B' },
	{ start: 0x0400, end: 0x04FF, name: 'Cyrillic' },
	{ start: 0x0370, end: 0x03FF, name: 'Greek' }
];

const BATCH_SIZE = 64;
const BATCH_DELAY = 0;

let glyph_detection_canvas = null;
let glyph_detection_ctx = null;
let active_detection = null;

const get_detection_canvas = () => {
	if (!glyph_detection_canvas) {
		glyph_detection_canvas = document.createElement('canvas');
		glyph_detection_canvas.width = 32;
		glyph_detection_canvas.height = 32;
		glyph_detection_ctx = glyph_detection_canvas.getContext('2d', { willReadFrequently: true });
	}

	return glyph_detection_ctx;
};

const compute_alpha_sum = (data) => {
	let sum = 0;
	for (let i = 3; i < data.length; i += 4)
		sum += data[i];

	return sum;
};

const check_glyph_support = (ctx, font_family, char) => {
	const fallback_font = '32px monospace';
	const target_font = `32px "${font_family}", monospace`;

	ctx.clearRect(0, 0, 32, 32);
	ctx.font = fallback_font;
	ctx.fillStyle = 'white';
	ctx.fillText(char, 0, 24);
	const fallback_sum = compute_alpha_sum(ctx.getImageData(0, 0, 32, 32).data);

	ctx.clearRect(0, 0, 32, 32);
	ctx.font = target_font;
	ctx.fillText(char, 0, 24);
	const target_sum = compute_alpha_sum(ctx.getImageData(0, 0, 32, 32).data);

	return fallback_sum !== target_sum;
};

const detect_glyphs_async = (font_family, grid_element, on_glyph_click, on_complete) => {
	if (active_detection)
		active_detection.cancelled = true;

	const detection = { cancelled: false };
	active_detection = detection;

	grid_element.innerHTML = '';

	const ctx = get_detection_canvas();
	const all_codepoints = [];

	for (const range of GLYPH_RANGES) {
		for (let code = range.start; code <= range.end; code++)
			all_codepoints.push(code);
	}

	let index = 0;

	const process_batch = () => {
		if (detection.cancelled)
			return;

		const batch_end = Math.min(index + BATCH_SIZE, all_codepoints.length);
		const fragment = document.createDocumentFragment();

		while (index < batch_end) {
			const code = all_codepoints[index++];
			const char = String.fromCodePoint(code);

			if (check_glyph_support(ctx, font_family, char)) {
				const cell = document.createElement('span');
				cell.className = 'font-glyph-cell';
				cell.textContent = char;
				cell.style.fontFamily = `"${font_family}", monospace`;
				cell.title = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
				cell.addEventListener('click', () => on_glyph_click(char));
				fragment.appendChild(cell);
			}
		}

		grid_element.appendChild(fragment);

		if (index < all_codepoints.length)
			setTimeout(process_batch, BATCH_DELAY);
		else if (on_complete)
			on_complete();
	};

	setTimeout(process_batch, 0);
};

const get_random_quote = () => {
	const quotes = constants.FONT_PREVIEW_QUOTES;
	return quotes[Math.floor(Math.random() * quotes.length)];
};

const inject_font_face = async (font_id, blob_data, log, on_error) => {
	const { BlobPolyfill, URLPolyfill } = require('../blob');

	const blob = new BlobPolyfill([blob_data], { type: 'font/ttf' });
	const url = URLPolyfill.createObjectURL(blob);

	const style = document.createElement('style');
	style.id = 'font-style-' + font_id;
	style.textContent = `@font-face { font-family: '${font_id}'; src: url('${url}'); }`;
	document.head.appendChild(style);

	await document.fonts.load('16px "' + font_id + '"');
	const loaded = document.fonts.check('16px "' + font_id + '"');

	if (!loaded) {
		document.head.removeChild(style);
		throw new Error('font failed to decode');
	}

	return url;
};

module.exports = {
	detect_glyphs_async,
	get_random_quote,
	inject_font_face
};
