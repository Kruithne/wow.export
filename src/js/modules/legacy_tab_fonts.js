const path = require('path');
const fsp = require('fs').promises;
const log = require('../log');
const InstallType = require('../install-type');
const constants = require('../constants');
const { BlobPolyfill, URLPolyfill } = require('../blob');

const loaded_fonts = new Map();

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

	// render with fallback only
	ctx.clearRect(0, 0, 32, 32);
	ctx.font = fallback_font;
	ctx.fillStyle = 'white';
	ctx.fillText(char, 0, 24);
	const fallback_sum = compute_alpha_sum(ctx.getImageData(0, 0, 32, 32).data);

	// render with target font
	ctx.clearRect(0, 0, 32, 32);
	ctx.font = target_font;
	ctx.fillText(char, 0, 24);
	const target_sum = compute_alpha_sum(ctx.getImageData(0, 0, 32, 32).data);

	return fallback_sum !== target_sum;
};

const detect_glyphs_async = (font_family, grid_element, on_glyph_click, on_complete) => {
	// cancel any active detection
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

	// start async processing
	setTimeout(process_batch, 0);
};

const get_random_quote = () => {
	const quotes = constants.FONT_PREVIEW_QUOTES;
	return quotes[Math.floor(Math.random() * quotes.length)];
};

const get_font_id = (file_name) => {
	// create a simple hash from the filename for legacy fonts
	let hash = 0;
	for (let i = 0; i < file_name.length; i++)
		hash = ((hash << 5) - hash + file_name.charCodeAt(i)) | 0;

	return 'font_legacy_' + Math.abs(hash);
};

const load_font = async (core, file_name) => {
	const font_id = get_font_id(file_name);

	if (loaded_fonts.has(font_id))
		return font_id;

	try {
		const data = core.view.mpq.getFile(file_name);
		if (!data) {
			log.write('failed to load legacy font: %s', file_name);
			return null;
		}

		const blob = new BlobPolyfill([new Uint8Array(data)], { type: 'font/ttf' });
		const url = URLPolyfill.createObjectURL(blob);

		const style = document.createElement('style');
		style.id = 'font-style-' + font_id;
		style.textContent = `@font-face { font-family: '${font_id}'; src: url('${url}'); }`;
		document.head.appendChild(style);

		// verify font loaded correctly
		await document.fonts.load('16px "' + font_id + '"');
		const loaded = document.fonts.check('16px "' + font_id + '"');
		if (!loaded) {
			document.head.removeChild(style);
			throw new Error('font failed to decode');
		}

		loaded_fonts.set(font_id, url);
		log.write('loaded legacy font %s as %s', file_name, font_id);

		return font_id;
	} catch (e) {
		log.write('failed to load legacy font %s: %s', file_name, e.message);
		core.setToast('error', 'Failed to load font: ' + e.message);
		return null;
	}
};

const load_font_list = async (core) => {
	if (core.view.listfileFonts.length === 0 && !core.view.isBusy) {
		using _lock = core.create_busy_lock();

		try {
			core.view.listfileFonts = core.view.mpq.getFilesByExtension('.ttf');
		} catch (e) {
			log.write('failed to load legacy fonts: %o', e);
		}
	}
};

module.exports = {
	register() {
		this.registerNavButton('Fonts', 'font.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="legacy-tab-fonts">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionFonts" :items="$core.view.listfileFonts" :filter="$core.view.userInputFilterFonts" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="font" persistscrollkey="fonts"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterFonts" placeholder="Filter fonts..."/>
			</div>
			<div class="preview-container font-preview">
				<div class="font-preview-grid">
					<div class="font-character-grid"></div>
					<div class="font-preview-input-container">
						<textarea class="font-preview-input" :style="{ fontFamily: $core.view.fontPreviewFontFamily }" :placeholder="$core.view.fontPreviewPlaceholder" v-model="$core.view.fontPreviewText"></textarea>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<input type="button" value="Export Selected" @click="export_fonts" :class="{ disabled: $core.view.isBusy }"/>
			</div>
		</div>
	`,

	methods: {
		async export_fonts() {
			const selected = this.$core.view.selectionFonts;
			if (selected.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			using _lock = this.$core.create_busy_lock();
			const export_dir = this.$core.view.config.exportDirectory;

			let exported = 0;
			let failed = 0;
			let last_export_path = null;

			for (const file_name of selected) {
				try {
					const export_path = path.join(export_dir, file_name);
					const data = this.$core.view.mpq.getFile(file_name);
					if (data) {
						await fsp.mkdir(path.dirname(export_path), { recursive: true });
						await fsp.writeFile(export_path, new Uint8Array(data));
						last_export_path = export_path;
						exported++;
					} else {
						log.write('failed to read font file from MPQ: %s', file_name);
						failed++;
					}
				} catch (e) {
					log.write('failed to export font %s: %o', file_name, e);
					failed++;
				}
			}

			if (failed > 0) {
				this.$core.setToast('error', `Exported ${exported} fonts with ${failed} failures.`);
			} else if (last_export_path) {
				const dir = path.dirname(last_export_path);
				const toast_opt = { 'View in Explorer': () => nw.Shell.openItem(dir) };

				if (selected.length > 1)
					this.$core.setToast('success', `Successfully exported ${exported} fonts.`, toast_opt, -1);
				else
					this.$core.setToast('success', `Successfully exported ${path.basename(last_export_path)}.`, toast_opt, -1);
			}
		}
	},

	async mounted() {
		await load_font_list(this.$core);

		this.$core.view.fontPreviewPlaceholder = get_random_quote();
		this.$core.view.fontPreviewText = '';
		this.$core.view.fontPreviewFontFamily = '';

		const grid_element = this.$el.querySelector('.font-character-grid');
		const on_glyph_click = (char) => this.$core.view.fontPreviewText += char;

		this.$core.view.$watch('selectionFonts', async selection => {
			const first = selection[0];
			if (first && !this.$core.view.isBusy) {
				const font_id = await load_font(this.$core, first);
				if (font_id) {
					this.$core.view.fontPreviewFontFamily = font_id;
					detect_glyphs_async(font_id, grid_element, on_glyph_click);
				}
			}
		});
	}
};
