const log = require('../log');
const WDCReader = require('../db/WDCReader');
const dbd_manifest = require('../casc/dbd-manifest');
const dataExporter = require('../ui/data-exporter');
const InstallType = require('../install-type');

let selected_file = null;
let selected_file_data_id = null;

const initialize_available_tables = async (core) => {
	const manifest = core.view.dbdManifest;
	if (manifest.length > 0)
		return;

	try {
		await dbd_manifest.prepareManifest();
		const table_names = dbd_manifest.getAllTableNames();
		manifest.push(...table_names);
		log.write('initialized available db2 tables from dbd manifest');
	} catch (e) {
		log.write('failed to initialize available db2 tables: %s', e.message);
	}
};

const load_table = async (core, table_name) => {
	try {
		selected_file_data_id = dbd_manifest.getByTableName(table_name) || null;

		const db2_reader = new WDCReader('DBFilesClient/' + table_name + '.db2');
		await db2_reader.parse();

		const all_headers = [...db2_reader.schema.keys()];
		const id_index = all_headers.findIndex(header => header.toUpperCase() === 'ID');
		if (id_index > 0) {
			const id_header = all_headers.splice(id_index, 1)[0];
			all_headers.unshift(id_header);
		}

		core.view.tableBrowserHeaders = all_headers;
		core.view.selectionDataTable = [];

		const rows = await db2_reader.getAllRows();
		if (rows.size == 0)
			core.setToast('info', 'Selected DB2 has no rows.', null);
		else
			core.hideToast(false);

		const parsed = Array(rows.size);

		let index = 0;
		for (const row of rows.values()) {
			const row_values = Object.values(row);
			if (id_index > 0) {
				const id_value = row_values.splice(id_index, 1)[0];
				row_values.unshift(id_value);
			}

			parsed[index++] = row_values;
		}

		core.view.tableBrowserRows = parsed;
		selected_file = table_name;
	} catch (e) {
		core.setToast('error', 'Unable to open DB2 file ' + table_name, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to open CASC file: %s', e.message);
	}
};

module.exports = {
	register() {
		this.registerNavButton('Data', 'database.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-data">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionDB2s" :items="$core.view.dbdManifest" :filter="$core.view.userInputFilterDB2s" :keyinput="true"
					:regex="$core.view.config.regexFilters" :copydir="$core.view.config.copyFileDirectories" :pasteselection="$core.view.config.pasteSelection"
					:copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="false" unittype="db2 file" :single="true" :nocopy="true"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterDB2s" placeholder="Filter DB2s.." />
			</div>
			<div class="list-container">
				<component ref="dataTable" :is="$components.DataTable" :headers="$core.view.tableBrowserHeaders" :rows="$core.view.tableBrowserRows" :filter="$core.view.userInputFilterDataTable" :regex="$core.view.config.regexFilters" :selection="$core.view.selectionDataTable" :copyheader="$core.view.config.dataCopyHeader" @update:filter="$core.view.userInputFilterDataTable = $event" @update:selection="$core.view.selectionDataTable = $event" @contextmenu="handle_context_menu" @copy="copy_rows_csv"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeDataTable" v-slot:default="context" @close="$core.view.contextMenus.nodeDataTable = null">
					<span @click.self="copy_rows_csv">Copy {{ context.node.selectedCount }} row{{ context.node.selectedCount !== 1 ? 's' : '' }} as CSV</span>
					<span @click.self="copy_cell(context.node.cellValue)">Copy cell contents</span>
				</component>
			</div>
			<div id="tab-data-options">
				<label class="ui-checkbox" title="Include header row when copying">
					<input type="checkbox" v-model="$core.view.config.dataCopyHeader"/>
					<span>Copy Header</span>
				</label>
				<label class="ui-checkbox" title="Export all rows">
					<input type="checkbox" v-model="$core.view.config.dataExportAll"/>
					<span>Export all rows</span>
				</label>
			</div>
			<div id="tab-data-tray">
				<div class="filter">
					<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
					<input type="text" id="data-table-filter-input" v-model="$core.view.userInputFilterDataTable" placeholder="Filter data table rows..." />
				</div>
				<input type="button" value="Export as CSV" @click="export_csv" :class="{ disabled: $core.view.isBusy || !$core.view.tableBrowserHeaders || $core.view.tableBrowserHeaders.length === 0 }"/>
				<input type="button" value="Export DB2" @click="export_db2" :class="{ disabled: $core.view.isBusy || !$core.view.tableBrowserHeaders || $core.view.tableBrowserHeaders.length === 0 }"/>
			</div>
		</div>
	`,

	methods: {
		handle_context_menu(data) {
			this.$core.view.contextMenus.nodeDataTable = data;
		},

		copy_rows_csv() {
			const data_table = this.$refs.dataTable;
			if (!data_table)
				return;

			const csv = data_table.getSelectedRowsAsCSV();
			if (!csv)
				return;

			nw.Clipboard.get().set(csv, 'text');

			const count = this.$core.view.selectionDataTable.length;
			this.$core.setToast('success', 'Copied ' + count + ' row' + (count !== 1 ? 's' : '') + ' to the clipboard', null, 2000);
		},

		copy_cell(value) {
			if (value === null || value === undefined)
				return;

			nw.Clipboard.get().set(String(value), 'text');
		},

		async export_csv() {
			const headers = this.$core.view.tableBrowserHeaders;
			const all_rows = this.$core.view.tableBrowserRows;
			const selection = this.$core.view.selectionDataTable;
			const export_all = this.$core.view.config.dataExportAll;

			if (!headers || !all_rows || headers.length === 0 || all_rows.length === 0) {
				this.$core.setToast('info', 'No data table loaded to export.');
				return;
			}

			let rows_to_export;
			if (export_all) {
				rows_to_export = all_rows;
			} else {
				if (!selection || selection.length === 0) {
					this.$core.setToast('info', 'No rows selected. Please select some rows first or enable "Export all rows".');
					return;
				}

				rows_to_export = selection.map(row_index => all_rows[row_index]).filter(row => row !== undefined);
				if (rows_to_export.length === 0) {
					this.$core.setToast('info', 'No rows selected. Please select some rows first or enable "Export all rows".');
					return;
				}
			}

			await dataExporter.exportDataTable(headers, rows_to_export, selected_file || 'unknown_table');
		},

		async export_db2() {
			if (!selected_file || !selected_file_data_id) {
				this.$core.setToast('info', 'No DB2 file selected to export.');
				return;
			}

			await dataExporter.exportRawDB2(selected_file, selected_file_data_id);
		}
	},

	async mounted() {
		this.$core.showLoadingScreen(1);

		try {
			await this.$core.progressLoadingScreen('Loading data table manifest...');
			await initialize_available_tables(this.$core);

			this.$core.hideLoadingScreen();
		} catch (error) {
			this.$core.hideLoadingScreen();
			log.write('Failed to initialize data tab: %o', error);
			this.$core.setToast('error', 'Failed to load data table manifest. Check the log for details.');
		}

		this.$core.view.$watch('selectionDB2s', async selection => {
			const first = selection[0];
			if (!this.$core.view.isBusy && first && selected_file !== first)
				await load_table(this.$core, first);
		});
	}
};
