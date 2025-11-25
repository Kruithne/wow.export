const path = require('path');
const fsp = require('fs').promises;
const log = require('../log');
const InstallType = require('../install-type');

let files_loaded = false;

const load_files = async (core) => {
	if (files_loaded || core.view.isBusy)
		return;

	core.view.isBusy++;

	try {
		const files = core.view.mpq.getAllFiles();
		core.view.listfileRaw = files;
		files_loaded = true;
	} catch (e) {
		log.write('failed to load legacy files: %o', e);
	}

	core.view.isBusy--;
};

const export_files = async (core) => {
	const selection = core.view.selectionRaw;
	if (selection.length === 0)
		return;

	core.view.isBusy++;

	try {
		const export_dir = core.view.config.exportDirectory;
		let last_export_path = null;

		for (const display_path of selection) {
			const data = core.view.mpq.getFile(display_path);
			if (!data) {
				log.write('failed to read file: %s', display_path);
				continue;
			}

			const output_path = path.join(export_dir, display_path);
			const output_dir = path.dirname(output_path);

			await fsp.mkdir(output_dir, { recursive: true });
			await fsp.writeFile(output_path, new Uint8Array(data));

			last_export_path = output_path;
			log.write('exported: %s', display_path);
		}

		if (last_export_path) {
			const dir = path.dirname(last_export_path);
			const toast_opt = { 'View in Explorer': () => nw.Shell.openItem(dir) };

			if (selection.length > 1)
				core.setToast('success', `Successfully exported ${selection.length} files.`, toast_opt, -1);
			else
				core.setToast('success', `Successfully exported ${path.basename(last_export_path)}.`, toast_opt, -1);
		}
	} catch (e) {
		log.write('failed to export legacy files: %o', e);
		core.setToast('error', 'Failed to export files');
	}

	core.view.isBusy--;
};

module.exports = {
	register() {
		this.registerNavButton('Files', 'file-lines.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="legacy-tab-files">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionRaw" :items="$core.view.listfileRaw" :filter="$core.view.userInputFilterRaw" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="file" persistscrollkey="legacy-files"></listbox>
			</div>
			<div id="tab-legacy-files-tray">
				<div class="filter">
					<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
					<input type="text" v-model="$core.view.userInputFilterRaw" placeholder="Filter files..."/>
				</div>
				<input type="button" value="Export Selected" @click="export_selected" :class="{ disabled: $core.view.isBusy || $core.view.selectionRaw.length === 0 }"/>
			</div>
		</div>
	`,

	methods: {
		async export_selected() {
			await export_files(this.$core);
		}
	},

	async mounted() {
		await load_files(this.$core);
	}
};
