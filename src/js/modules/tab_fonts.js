const path = require('path');
const log = require('../log');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const InstallType = require('../install-type');
const constants = require('../constants');
const { BlobPolyfill, URLPolyfill } = require('../blob');

const loaded_fonts = new Map();

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

		this.$core.view.$watch('selectionFonts', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
			if (first && !this.$core.view.isBusy) {
				const font_id = await load_font(this.$core, first);
				if (font_id)
					this.$core.view.fontPreviewFontFamily = font_id;
			}
		});
	}
};
