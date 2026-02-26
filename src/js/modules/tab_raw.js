import log from '../log.js';
import generics from '../generics.js';
import constants from '../constants.js';
import { listfile } from '../../views/main/rpc.js';
import { exporter } from '../../views/main/rpc.js';
import listboxContext from '../ui/listbox-context.js';

const ExportHelper = exporter;

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

	core.setToast('success', `Found ${core.view.listfileRaw.length} files in the game client`);
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

	using _lock = core.create_busy_lock();

	const extension_map = new Map();
	let current_index = 1;

	for (const file_data_id of filtered_selection) {
		core.setToast('progress', `Identifying file ${file_data_id} (${current_index++} / ${filtered_selection.length})`);

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
			core.setToast('success', `${file_data_id} has been identified as a ${ext} file`);
		} else {
			core.setToast('success', `Successfully identified ${extension_map.size} files`);
		}

		core.setToast('success', `${extension_map.size} of the ${filtered_selection.length} selected files have been identified and added to relevant file lists`);
	} else {
		core.setToast('info', 'Unable to identify any of the selected files.');
	}
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
				const dot_idx = file_name.lastIndexOf('.');
				const ext = dot_idx !== -1 ? file_name.substring(dot_idx) : '';
				const slash_idx = file_name.lastIndexOf('/');
				const dir = slash_idx !== -1 ? file_name.substring(0, slash_idx) : '.';
				const file_data_id_name = file_data_id + ext;
				export_file_name = dir === '.' ? file_data_id_name : dir + '/' + file_data_id_name;
			}
		}

		const export_path = ExportHelper.getExportPath(export_file_name);

		if (overwrite_files || !await generics.fileExists(export_path)) {
			try {
				const data = await core.view.casc.getFileByName(file_name, true);
				await data.writeToFile(export_path);

				helper.mark(export_file_name, true);
			} catch (e) {
				helper.mark(export_file_name, false, e.message, e.stack);
			}
		} else {
			helper.mark(export_file_name, true);
			log.write('Skipping file export %s (file exists, overwrite disabled)', export_path);
		}
	}

	helper.finish();
};

export default {
	register() {
		this.registerContextMenuOption('Browse Raw Client Files', 'fish.svg');
	},

	template: `
		<div class="tab list-tab" id="tab-raw">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionRaw" :items="$core.view.listfileRaw" :filter="$core.view.userInputFilterRaw" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="file" persistscrollkey="raw" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_listfile_format(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }} (listfile format)</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_file_data_ids(context.node.selection)">Copy file data ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
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
