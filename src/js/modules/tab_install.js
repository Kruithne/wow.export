const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const generics = require('../generics');
const listfile = require('../casc/listfile');

let manifest = null;

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

module.exports = {
	register() {
		this.registerContextMenuOption('Browse Install Manifest', 'clipboard-list.svg');
	},

	template: `
		<div class="tab list-tab" id="tab-install">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionInstall" :items="$core.view.listfileInstall" :filter="$core.view.userInputFilterInstall" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="install file" persistscrollkey="install"></listbox>
			</div>
			<div id="tab-install-tray">
				<div class="filter">
					<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
					<input type="text" v-model="$core.view.userInputFilterInstall" placeholder="Filter install files..."/>
				</div>
				<input type="button" value="Export Selected" @click="export_install" :class="{ disabled: $core.view.isBusy }"/>
			</div>
			<div class="sidebar">
				<label v-for="tag in $core.view.installTags" class="ui-checkbox">
					<input type="checkbox" v-model="tag.enabled"/>
					<span>{{ tag.label }}</span>
				</label>
			</div>
		</div>
	`,

	methods: {
		async export_install() {
			await export_install_files(this.$core);
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
