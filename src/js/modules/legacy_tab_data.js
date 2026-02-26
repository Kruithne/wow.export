import log from '../log.js';
import * as platform from '../platform.js';
import dataExporter from '../ui/data-exporter.js';
import InstallType from '../install-type.js';
import { exporter as ExportHelper, dbc } from '../../views/main/rpc.js';
import BufferWrapper from '../buffer.js';
import generics from '../generics.js';

let selected_file = null;
let selected_file_path = null;
let selected_file_schema = null;
let dbc_listfile = [];
let dbc_path_map = new Map();

const DBC_EXTENSION = '.dbc';

const initialize_dbc_listfile = async (core) => {
	if (dbc_listfile.length > 0)
		return;

	const mpq = core.view.mpq;
	if (!mpq)
		return;

	const all_dbc_files = mpq.getFilesByExtension(DBC_EXTENSION);

	dbc_path_map.clear();
	const table_names = new Set();

	for (const full_path of all_dbc_files) {
		const parts = full_path.split('\\');
		const dbc_file = parts[parts.length - 1];
		const table_name = dbc_file.replace(/\.dbc$/i, '');

		if (!dbc_path_map.has(table_name)) {
			dbc_path_map.set(table_name, full_path);
			table_names.add(table_name);
		}
	}

	dbc_listfile = Array.from(table_names).sort((a, b) => a.localeCompare(b));
	log.write('initialized %d dbc files from mpq archives', dbc_listfile.length);
};

const load_table = async (core, table_name) => {
	try {
		const mpq = core.view.mpq;
		const full_path = dbc_path_map.get(table_name);

		if (!full_path) {
			core.setToast('error', `Unable to find DBC file: ${table_name}`, null, -1);
			return;
		}

		let raw_data = mpq.getFile(full_path);

		if (!raw_data) {
			core.setToast('error', `Unable to load DBC file: ${full_path}`, null, -1);
			return;
		}

		const data = new BufferWrapper(raw_data);

		const build_id = get_build_version(core);

		const dbc_reader = new DBCReader(table_name + '.dbc', build_id);
		await dbc_reader.parse(data);

		const all_headers = [...dbc_reader.schema.keys()];
		const id_index = all_headers.findIndex(header => header.toUpperCase() === 'ID');
		if (id_index > 0) {
			const id_header = all_headers.splice(id_index, 1)[0];
			all_headers.unshift(id_header);
		}

		core.view.tableBrowserHeaders = all_headers;
		core.view.selectionDataTable = [];

		const rows = await dbc_reader.getAllRows();
		if (rows.size == 0)
			core.setToast('info', 'Selected DBC has no rows.', null);
		else
			core.hideToast(false);

		const parsed = Array(rows.size);

		let index = 0;
		for (const row of rows.values()) {
			const row_values = [];
			for (const header of all_headers) {
				const value = row[header];
				if (Array.isArray(value))
					row_values.push(value.join(', '));
				else
					row_values.push(value);
			}
			parsed[index++] = row_values;
		}

		core.view.tableBrowserRows = parsed;
		selected_file = table_name;
		selected_file_path = full_path;
		selected_file_schema = dbc_reader.schema;
	} catch (e) {
		core.setToast('error', 'Unable to open DBC file ' + table_name, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to open DBC file: %s', e.message);
		log.write('%o', e.stack);
	}
};

const get_build_version = (core) => {
	return core.view.mpq?.build_id ?? '1.12.1.5875';
};

export default {
	register() {
		this.registerNavButton('Data', 'database.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="tab-data">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionDB2s" :items="dbcListfile" :filter="$core.view.userInputFilterDB2s" :keyinput="true"
					:regex="$core.view.config.regexFilters" :copydir="$core.view.config.copyFileDirectories" :pasteselection="$core.view.config.pasteSelection"
					:copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="false" unittype="dbc file" :single="true" :nocopy="true"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterDB2s" placeholder="Filter DBCs.." />
			</div>
			<div class="list-container">
				<component ref="dataTable" :is="$components.DataTable" :headers="$core.view.tableBrowserHeaders" :rows="$core.view.tableBrowserRows" :filter="$core.view.userInputFilterDataTable" :regex="$core.view.config.regexFilters" :selection="$core.view.selectionDataTable" :copyheader="$core.view.config.dataCopyHeader" :tablename="$core.view.selectionDB2s[0]" @update:filter="$core.view.userInputFilterDataTable = $event" @update:selection="$core.view.selectionDataTable = $event" @contextmenu="handle_context_menu" @copy="copy_rows_csv"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeDataTable" v-slot:default="context" @close="$core.view.contextMenus.nodeDataTable = null">
					<span @click.self="copy_rows_csv">Copy {{ context.node.selectedCount }} row{{ context.node.selectedCount !== 1 ? 's' : '' }} as CSV</span>
					<span @click.self="copy_rows_sql">Copy {{ context.node.selectedCount }} row{{ context.node.selectedCount !== 1 ? 's' : '' }} as SQL</span>
					<span @click.self="copy_cell(context.node.cellValue)">Copy cell contents</span>
				</component>
			</div>
			<div id="tab-data-options">
				<label class="ui-checkbox" title="Include header row when copying" v-if="$core.view.config.exportDataFormat === 'CSV'">
					<input type="checkbox" v-model="$core.view.config.dataCopyHeader"/>
					<span>Copy Header</span>
				</label>
				<label class="ui-checkbox" title="Include DROP/CREATE TABLE statements" v-if="$core.view.config.exportDataFormat === 'SQL'">
					<input type="checkbox" v-model="$core.view.config.dataSQLCreateTable"/>
					<span>Create Table</span>
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
				<component :is="$components.MenuButton" :options="menuButtonDataLegacy" :default="$core.view.config.exportDataFormat" @change="$core.view.config.exportDataFormat = $event" class="upward" :disabled="$core.view.isBusy || !$core.view.tableBrowserHeaders || $core.view.tableBrowserHeaders.length === 0" @click="export_data"></component>
			</div>
		</div>
	`,

	data() {
		return {
			dbcListfile: [],
			menuButtonDataLegacy: [
				{ label: 'Export as CSV', value: 'CSV' },
				{ label: 'Export as SQL', value: 'SQL' },
				{ label: 'Export DBC (Raw)', value: 'DBC' }
			]
		};
	},

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

			platform.clipboard_write_text(csv);

			const count = this.$core.view.selectionDataTable.length;
			this.$core.setToast('success', 'Copied ' + count + ' row' + (count !== 1 ? 's' : '') + ' as CSV to the clipboard', null, 2000);
		},

		copy_rows_sql() {
			const data_table = this.$refs.dataTable;
			if (!data_table)
				return;

			const sql = data_table.getSelectedRowsAsSQL();
			if (!sql)
				return;

			platform.clipboard_write_text(sql);

			const count = this.$core.view.selectionDataTable.length;
			this.$core.setToast('success', 'Copied ' + count + ' row' + (count !== 1 ? 's' : '') + ' as SQL to the clipboard', null, 2000);
		},

		copy_cell(value) {
			if (value === null || value === undefined)
				return;

			platform.clipboard_write_text(String(value));
		},

		async export_data() {
			const format = this.$core.view.config.exportDataFormat;

			if (format === 'CSV')
				await this.export_csv();
			else if (format === 'SQL')
				await this.export_sql();
			else if (format === 'DBC')
				await this.export_dbc();
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

		async export_sql() {
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

			const create_table = this.$core.view.config.dataSQLCreateTable;
			await dataExporter.exportDataTableSQL(headers, rows_to_export, selected_file || 'unknown_table', selected_file_schema, create_table);
		},

		async export_dbc() {
			if (!selected_file || !selected_file_path) {
				this.$core.setToast('info', 'No DBC file selected to export.');
				return;
			}

			await dataExporter.exportRawDBC(selected_file, selected_file_path, this.$core.view.mpq);
		}
	},

	async mounted() {
		this.$core.showLoadingScreen(1);

		try {
			await this.$core.progressLoadingScreen('Scanning DBC files...');
			await initialize_dbc_listfile(this.$core);

			this.dbcListfile = dbc_listfile;
			this.$core.hideLoadingScreen();
		} catch (error) {
			this.$core.hideLoadingScreen();
			log.write('Failed to initialize legacy data tab: %o', error);
			this.$core.setToast('error', 'Failed to load DBC files. Check the log for details.');
		}

		this.$core.view.$watch('selectionDB2s', async selection => {
			const first = selection[0];
			if (!this.$core.view.isBusy && first && selected_file !== first)
				await load_table(this.$core, first);
		});
	}
};
