const path = require('path');
const fsp = require('fs').promises;
const log = require('../log');
const InstallType = require('../install-type');

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
	}
};
