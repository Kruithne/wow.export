const util = require('util');
const path = require('path');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const constants = require('../constants');
const listfile = require('../casc/listfile');

let is_dirty = true;

const compute_raw_files = async (core) => {
	if (!is_dirty)
		return;

	is_dirty = false;

	core.setToast('progress', core.view.config.enableUnknownFiles ? 'Scanning game client for all files...' : 'Scanning game client for all known files...');
	await generics.redraw();

	if (core.view.config.enableUnknownFiles) {
		const root_entries = core.view.casc.getValidRootEntries();
		core.view.listfileRaw = await listfile.renderListfile(root_entries, true);
	} else {
		core.view.listfileRaw = await listfile.renderListfile();
	}

	core.setToast('success', util.format('Found %d files in the game client', core.view.listfileRaw.length));
};

const detect_raw_files = async (core) => {
	const user_selection = core.view.selectionRaw;
	if (user_selection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to detect; you should do that first.');
		return;
	}

	const filtered_selection = [];
	for (let file_name of user_selection) {
		file_name = listfile.stripFileEntry(file_name);
		const match = file_name.match(/^unknown\/(\d+)(\.[a-zA-Z_]+)?$/);

		if (match)
			filtered_selection.push(parseInt(match[1]));
	}

	if (filtered_selection.length === 0) {
		core.setToast('info', 'You haven\'t selected any unknown files to identify.');
		return;
	}

	core.view.isBusy++;

	const extension_map = new Map();
	let current_index = 1;

	for (const file_data_id of filtered_selection) {
		core.setToast('progress', util.format('Identifying file %d (%d / %d)', file_data_id, current_index++, filtered_selection.length));

		try {
			const data = await core.view.casc.getFile(file_data_id);
			for (const check of constants.FILE_IDENTIFIERS) {
				if (data.startsWith(check.match)) {
					extension_map.set(file_data_id, check.ext);
					log.write('Successfully identified file %d as %s', file_data_id, check.ext);
					break;
				}
			}
		} catch (e) {
			log.write('Failed to identify file %d due to CASC error', file_data_id);
		}
	}

	if (extension_map.size > 0) {
		listfile.ingestIdentifiedFiles(extension_map);
		await compute_raw_files(core);

		if (extension_map.size === 1) {
			const [file_data_id, ext] = extension_map.entries().next().value;
			core.setToast('success', util.format('%d has been identified as a %s file', file_data_id, ext));
		} else {
			core.setToast('success', util.format('Successfully identified %d files', extension_map.size));
		}

		core.setToast('success', util.format('%d of the %d selected files have been identified and added to relevant file lists', extension_map.size, filtered_selection.length));
	} else {
		core.setToast('info', 'Unable to identify any of the selected files.');
	}

	core.view.isBusy--;
};

const export_raw_files = async (core) => {
	const user_selection = core.view.selectionRaw;
	if (user_selection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(user_selection.length, 'file');
	helper.start();

	const overwrite_files = core.view.config.overwriteFiles;
	for (let file_name of user_selection) {
		if (helper.isCancelled())
			return;

		file_name = listfile.stripFileEntry(file_name);
		let export_file_name = file_name;

		if (!core.view.config.exportNamedFiles) {
			const file_data_id = listfile.getByFilename(file_name);
			if (file_data_id) {
				const ext = path.extname(file_name);
				const dir = path.dirname(file_name);
				const file_data_id_name = file_data_id + ext;
				export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
			}
		}

		const export_path = ExportHelper.getExportPath(export_file_name);

		if (overwrite_files || !await generics.fileExists(export_path)) {
			try {
				const data = await core.view.casc.getFileByName(file_name, true);
				await data.writeToFile(export_path);

				helper.mark(file_name, true);
			} catch (e) {
				helper.mark(file_name, false, e.message, e.stack);
			}
		} else {
			helper.mark(file_name, true);
			log.write('Skipping file export %s (file exists, overwrite disabled)', export_path);
		}
	}

	helper.finish();
};

module.exports = {
	register() {
		this.registerContextMenuOption('Browse Raw Client Files', 'fish.svg');
	},

	template: `
		<div class="tab list-tab" id="tab-raw">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionRaw" :items="$core.view.listfileRaw" :filter="$core.view.userInputFilterRaw" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="file" persistscrollkey="raw"></listbox>
			</div>
			<div id="tab-raw-tray">
				<div class="filter">
					<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
					<input type="text" v-model="$core.view.userInputFilterRaw" placeholder="Filter raw files..."/>
				</div>
				<input type="button" value="Auto-Detect Selected" @click="detect_raw" :class="{ disabled: $core.view.isBusy }"/>
				<input type="button" value="Export Selected" @click="export_raw" :class="{ disabled: $core.view.isBusy }"/>
			</div>
		</div>
	`,

	methods: {
		async detect_raw() {
			await detect_raw_files(this.$core);
		},

		async export_raw() {
			await export_raw_files(this.$core);
		}
	},

	async mounted() {
		await compute_raw_files(this.$core);

		this.$core.view.$watch('config.cascLocale', () => {
			is_dirty = true;
		});
	}
};
