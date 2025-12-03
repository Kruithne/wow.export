const path = require('path');
const util = require('util');
const log = require('../log');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const generics = require('../generics');
const InstallType = require('../install-type');

let selected_file = null;

module.exports = {
	register() {
		this.registerNavButton('Text', 'file-lines.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-text">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionText" :items="$core.view.listfileText" :filter="$core.view.userInputFilterText" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="text file" persistscrollkey="text" :quickfilters="$core.view.textQuickFilters"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterText" placeholder="Filter text files..."/>
			</div>
			<div class="preview-container">
				<div class="preview-background" id="model-preview">
					<pre>{{ $core.view.textViewerSelectedText }}</pre>
				</div>
			</div>
			<div class="preview-controls">
				<input type="button" value="Copy to Clipboard" @click="copy_text"/>
				<input type="button" value="Export Selected" @click="export_text" :class="{ disabled: $core.view.isBusy }"/>
			</div>
		</div>
	`,

	methods: {
		copy_text() {
			const clipboard = nw.Clipboard.get();
			clipboard.set(this.$core.view.textViewerSelectedText, 'text');
			this.$core.setToast('success', util.format('Copied contents of %s to the clipboard.', selected_file), null, -1, true);
		},

		async export_text() {
			const user_selection = this.$core.view.selectionText;
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
						log.write('Skipping text export %s (file exists, overwrite disabled)', export_path);
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
		this.$core.view.$watch('selectionText', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && selected_file !== first) {
				try {
					const file = await this.$core.view.casc.getFileByName(first);
					this.$core.view.textViewerSelectedText = file.readString(undefined, 'utf8');

					selected_file = first;
				} catch (e) {
					if (e instanceof EncryptionError) {
						this.$core.setToast('error', util.format('The text file %s is encrypted with an unknown key (%s).', first, e.key), null, -1);
						log.write('Failed to decrypt texture %s (%s)', first, e.key);
					} else {
						this.$core.setToast('error', 'Unable to preview text file ' + first, { 'View Log': () => log.openRuntimeLog() }, -1);
						log.write('Failed to open CASC file: %s', e.message);
					}
				}
			}
		});
	}
};
