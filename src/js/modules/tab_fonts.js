const path = require('path');
const log = require('../log');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
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

const get_font_id = (file_data_id) => {
	return 'font_id_' + file_data_id;
};

const load_font = async (core, file_name) => {
	const file_data_id = listfile.getByFilename(file_name);
	if (!file_data_id)
		return null;

	const font_id = get_font_id(file_data_id);

	if (loaded_fonts.has(font_id))
		return font_id;

	try {
		const data = await core.view.casc.getFileByName(file_name);
		data.processAllBlocks();

		const blob = new BlobPolyfill([data.raw], { type: 'font/ttf' });
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
		log.write('loaded font %s as %s', file_name, font_id);

		return font_id;
	} catch (e) {
		log.write('failed to load font %s: %s', file_name, e.message);
		core.setToast('error', 'Failed to load font: ' + e.message);
		return null;
	}
};

module.exports = {
	register() {
		this.registerNavButton('Fonts', 'font.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-fonts">
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
			const user_selection = this.$core.view.selectionFonts;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'file');
			helper.start();

			const overwrite_files = this.$core.view.config.overwriteFiles;
			for (let file_name of user_selection) {
				if (helper.isCancelled())
					return;

				file_name = listfile.stripFileEntry(file_name);
				let export_file_name = file_name;

				if (!this.$core.view.config.exportNamedFiles) {
					const file_data_id = listfile.getByFilename(file_name);
					if (file_data_id) {
						const ext = path.extname(file_name);
						const dir = path.dirname(file_name);
						const file_data_id_name = file_data_id + ext;
						export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
					}
				}

				try {
					const export_path = ExportHelper.getExportPath(export_file_name);
					if (overwrite_files || !await generics.fileExists(export_path)) {
						const data = await this.$core.view.casc.getFileByName(file_name);
						await data.writeToFile(export_path);
					} else {
						log.write('Skipping font export %s (file exists, overwrite disabled)', export_path);
					}

					helper.mark(file_name, true);
				} catch (e) {
					helper.mark(file_name, false, e.message, e.stack);
				}
			}

			helper.finish();
		}
	},

	mounted() {
		this.$core.view.fontPreviewPlaceholder = get_random_quote();
		this.$core.view.fontPreviewText = '';
		this.$core.view.fontPreviewFontFamily = '';

		const grid_element = this.$el.querySelector('.font-character-grid');
		const on_glyph_click = (char) => this.$core.view.fontPreviewText += char;

		this.$core.view.$watch('selectionFonts', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
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
