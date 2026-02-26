import log from '../log.js';
import * as platform from '../platform.js';
import generics from '../generics.js';
import { listfile } from '../../views/main/rpc.js';
import { exporter } from '../../views/main/rpc.js';

const ExportHelper = exporter;

let manifest = null;

const MIN_STRING_LENGTH = 4;

/**
 * extract printable strings from binary data.
 * @param {Buffer} data
 * @returns {string[]}
 */
const extract_strings = (data) => {
	const strings = [];
	let current = '';

	for (let i = 0; i < data.length; i++) {
		const byte = data[i];

		// printable ascii range (0x20-0x7E) plus tab (0x09)
		if ((byte >= 0x20 && byte <= 0x7E) || byte === 0x09) {
			current += String.fromCharCode(byte);
		} else {
			if (current.length >= MIN_STRING_LENGTH)
				strings.push(current);

			current = '';
		}
	}

	// handle trailing string
	if (current.length >= MIN_STRING_LENGTH)
		strings.push(current);

	return strings;
};

const update_install_listfile = (core) => {
	core.view.listfileInstall = manifest.files.filter((file) => {
		for (const tag of core.view.installTags) {
			if (tag.enabled && file.tags.includes(tag.label))
				return true;
		}

		return false;
	}).map(e => e.name + ' [' + e.tags.join(', ') + ']');
};

const export_install_files = async (core) => {
	const user_selection = core.view.selectionInstall;
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
		const file = manifest.files.find(e => e.name === file_name);
		const export_path = ExportHelper.getExportPath(file_name);

		if (overwrite_files || !await generics.fileExists(export_path)) {
			try {
				const data = await core.view.casc.getFile(0, false, false, true, false, file.hash);
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

const view_strings = async (core) => {
	const user_selection = core.view.selectionInstall;
	if (user_selection.length !== 1) {
		core.setToast('info', 'Please select exactly one file to view strings.');
		return;
	}

	const file_name = listfile.stripFileEntry(user_selection[0]);
	const file = manifest.files.find(e => e.name === file_name);

	core.setToast('progress', 'Analyzing binary for strings...', null, -1, false);
	core.view.isBusy++;

	try {
		const data = await core.view.casc.getFile(0, false, false, true, false, file.hash);
		data.processAllBlocks();
		const strings = extract_strings(data.raw);

		core.view.installStrings = strings;
		core.view.installStringsFileName = file_name;
		core.view.selectionInstallStrings = [];
		core.view.userInputFilterInstallStrings = '';
		core.view.installStringsView = true;

		log.write('Extracted %d strings from %s', strings.length, file_name);
	} catch (e) {
		core.setToast('error', 'Failed to analyze binary: ' + e.message);
		log.write('Failed to extract strings from %s: %s', file_name, e.message);
		core.view.isBusy--;
		return;
	}

	core.view.isBusy--;
	core.hideToast();
};

const export_strings = async (core) => {
	const strings = core.view.installStrings;
	if (strings.length === 0) {
		core.setToast('info', 'No strings to export.');
		return;
	}

	const full_name = core.view.installStringsFileName;
	const slash_idx = full_name.lastIndexOf('/');
	const name_part = slash_idx !== -1 ? full_name.substring(slash_idx + 1) : full_name;
	const dot_idx = name_part.lastIndexOf('.');
	const base_name = dot_idx !== -1 ? name_part.substring(0, dot_idx) : name_part;
	const export_path = ExportHelper.getExportPath(base_name + '_strings.txt');

	try {
		const dir_slash_idx = export_path.lastIndexOf('/');
		const dir_path_part = dir_slash_idx !== -1 ? export_path.substring(0, dir_slash_idx) : '.';
		await generics.createDirectory(dir_path_part);
		await generics.writeFile(export_path, strings.join('\n'), 'utf8');

		const export_dir_idx = export_path.lastIndexOf('/');
		const export_dir = export_dir_idx !== -1 ? export_path.substring(0, export_dir_idx) : '.';
		core.setToast('success', 'Exported ' + strings.length + ' strings.', { 'View in Explorer': () => platform.open_path(export_dir) });
		log.write('Exported %d strings to %s', strings.length, export_path);
	} catch (e) {
		core.setToast('error', 'Failed to export strings: ' + e.message);
		log.write('Failed to export strings: %s', e.message);
	}
};

const back_to_manifest = (core) => {
	core.view.installStringsView = false;
	core.view.installStrings = [];
	core.view.installStringsFileName = '';
	core.view.selectionInstallStrings = [];
	core.view.userInputFilterInstallStrings = '';
};

export default {
	register() {
		this.registerContextMenuOption('Browse Install Manifest', 'clipboard-list.svg');
	},

	template: `
		<div class="tab list-tab" id="tab-install">
			<template v-if="!$core.view.installStringsView">
				<div class="list-container">
					<component :is="$components.Listbox" v-model:selection="$core.view.selectionInstall" :items="$core.view.listfileInstall" :filter="$core.view.userInputFilterInstall" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="install file" persistscrollkey="install"></component>
				</div>
				<div id="tab-install-tray">
					<div class="filter">
						<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
						<input type="text" v-model="$core.view.userInputFilterInstall" placeholder="Filter install files..."/>
					</div>
					<input type="button" value="View Strings" @click="view_strings" :class="{ disabled: $core.view.isBusy }"/>
					<input type="button" value="Export Selected" @click="export_install" :class="{ disabled: $core.view.isBusy }"/>
				</div>
				<div class="sidebar">
					<label v-for="tag in $core.view.installTags" class="ui-checkbox">
						<input type="checkbox" v-model="tag.enabled"/>
						<span>{{ tag.label }}</span>
					</label>
				</div>
			</template>
			<template v-else>
				<div class="list-container">
					<component :is="$components.Listbox" v-model:selection="$core.view.selectionInstallStrings" :items="$core.view.installStrings" :filter="$core.view.userInputFilterInstallStrings" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :includefilecount="true" unittype="string" persistscrollkey="install-strings"></component>
				</div>
				<div id="tab-install-tray">
					<div class="filter">
						<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
						<input type="text" v-model="$core.view.userInputFilterInstallStrings" placeholder="Filter strings..."/>
					</div>
					<input type="button" value="Back to Manifest" @click="back_to_manifest"/>
					<input type="button" value="Export Strings" @click="export_strings" :class="{ disabled: $core.view.isBusy }"/>
				</div>
				<div class="sidebar strings-info">
					<span class="strings-header">Strings from:</span>
					<span class="strings-filename">{{ $core.view.installStringsFileName }}</span>
				</div>
			</template>
		</div>
	`,

	methods: {
		async export_install() {
			await export_install_files(this.$core);
		},

		async view_strings() {
			await view_strings(this.$core);
		},

		async export_strings() {
			await export_strings(this.$core);
		},

		back_to_manifest() {
			back_to_manifest(this.$core);
		}
	},

	async mounted() {
		this.$core.setToast('progress', 'Retrieving installation manifest...', null, -1, false);
		manifest = await this.$core.view.casc.getInstallManifest();

		this.$core.view.installTags = manifest.tags.map(e => ({ label: e.name, enabled: true, mask: e.mask }));
		this.$core.view.$watch('installTags', () => update_install_listfile(this.$core), { deep: true, immediate: true });

		this.$core.hideToast();
	}
};
