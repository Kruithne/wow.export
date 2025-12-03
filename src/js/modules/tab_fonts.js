const path = require('path');
const log = require('../log');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const listboxContext = require('../ui/listbox-context');
const InstallType = require('../install-type');
const { detect_glyphs_async, get_random_quote, inject_font_face } = require('./font_helpers');

const loaded_fonts = new Map();

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

		const url = await inject_font_face(font_id, data.raw, log);
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
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionFonts" :items="$core.view.listfileFonts" :filter="$core.view.userInputFilterFonts" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="font" persistscrollkey="fonts" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_listfile_format(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }} (listfile format)</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_file_data_ids(context.node.selection)">Copy file data ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
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
		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		copy_file_paths(selection) {
			listboxContext.copy_file_paths(selection);
		},

		copy_listfile_format(selection) {
			listboxContext.copy_listfile_format(selection);
		},

		copy_file_data_ids(selection) {
			listboxContext.copy_file_data_ids(selection);
		},

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

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

					helper.mark(export_file_name, true);
				} catch (e) {
					helper.mark(export_file_name, false, e.message, e.stack);
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
