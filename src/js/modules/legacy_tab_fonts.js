const path = require('path');
const fsp = require('fs').promises;
const log = require('../log');
const platform = require('../platform');
const listboxContext = require('../ui/listbox-context');
const InstallType = require('../install-type');
const { detect_glyphs_async, get_random_quote, inject_font_face } = require('./font_helpers');

const loaded_fonts = new Map();

const get_font_id = (file_name) => {
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

		const url = await inject_font_face(font_id, new Uint8Array(data), log);
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
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionFonts" :items="$core.view.listfileFonts" :filter="$core.view.userInputFilterFonts" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="font" persistscrollkey="fonts" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
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
			listboxContext.handle_context_menu(data, true);
		},

		copy_file_paths(selection) {
			listboxContext.copy_file_paths(selection);
		},

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

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
				const toast_opt = { 'View in Explorer': () => platform.open_path(dir) };

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
