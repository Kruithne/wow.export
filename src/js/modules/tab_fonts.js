const path = require('path');
const log = require('../log');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const InstallType = require('../install-type');

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
	}
};
