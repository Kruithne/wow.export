import log from '../log.js';
import * as platform from '../platform.js';
import listboxContext from '../ui/listbox-context.js';
import InstallType from '../install-type.js';
import generics from '../generics.js';

let files_loaded = false;

const load_files = async (core) => {
	if (files_loaded || core.view.isBusy)
		return;

	using _lock = core.create_busy_lock();

	try {
		const files = await core.view.mpq.getAllFiles();
		core.view.listfileRaw = files;
		files_loaded = true;
	} catch (e) {
		log.write('failed to load legacy files: %o', e);
	}
};

const export_files = async (core) => {
	const selection = core.view.selectionRaw;
	if (selection.length === 0)
		return;

	using _lock = core.create_busy_lock();

	try {
		const export_dir = core.view.config.exportDirectory;
		let last_export_path = null;

		for (const display_path of selection) {
			const data = await core.view.mpq.getFile(display_path);
			if (!data) {
				log.write('failed to read file: %s', display_path);
				continue;
			}

			const output_path = export_dir + '/' + display_path;
			const output_dir = output_path.substring(0, output_path.lastIndexOf('/'));

			await generics.createDirectory(output_dir);
			await generics.writeFile(output_path, new Uint8Array(data));

			last_export_path = output_path;
			log.write('exported: %s', display_path);
		}

		if (last_export_path) {
			const dir = last_export_path.substring(0, last_export_path.lastIndexOf('/'));
			const toast_opt = { 'View in Explorer': () => platform.open_path(dir) };
			const base_name = last_export_path.substring(last_export_path.lastIndexOf('/') + 1);

			if (selection.length > 1)
				core.setToast('success', `Successfully exported ${selection.length} files.`, toast_opt, -1);
			else
				core.setToast('success', `Successfully exported ${base_name}.`, toast_opt, -1);
		}
	} catch (e) {
		log.write('failed to export legacy files: %o', e);
		core.setToast('error', 'Failed to export files');
	}
};

export default {
	register() {
		this.registerNavButton('Files', 'file-lines.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="legacy-tab-files">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionRaw" :items="$core.view.listfileRaw" :filter="$core.view.userInputFilterRaw" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="file" persistscrollkey="legacy-files" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
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

		async export_selected() {
			await export_files(this.$core);
		}
	},

	async mounted() {
		await load_files(this.$core);
	}
};
