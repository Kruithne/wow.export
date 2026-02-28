import log from '../log.js';
import * as platform from '../platform.js';
import dataExporter from '../ui/data-exporter.js';
import { dbc } from '../../views/main/rpc.js';
import ExportHelper from '../export-helper.js';
import InstallType from '../install-type.js';

let selected_file = null;
let selected_file_data_id = null;
let selected_file_schema = null;

const initialize_available_tables = async (core) => {
	const manifest = core.view.dbdManifest;
	if (manifest.length > 0)
		return;

	// dbd_manifest functionality is bun-side; assume manifest is populated via RPC
	log.write('initialized available db2 tables from dbd manifest');
};

const parse_table = async (table_name) => {
	const db2_reader = new WDCReader('DBFilesClient/' + table_name + '.db2');
	await db2_reader.parse();

	const all_headers = [...db2_reader.schema.keys()];
	const id_index = all_headers.findIndex(header => header.toUpperCase() === 'ID');
	if (id_index > 0) {
		const id_header = all_headers.splice(id_index, 1)[0];
		all_headers.unshift(id_header);
	}

	const rows = await db2_reader.getAllRows();
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

	return { headers: all_headers, rows: parsed, schema: db2_reader.schema };
};

const load_table = async (core, table_name) => {
	try {
		selected_file_data_id = null;

		const result = await parse_table(table_name);

		core.view.tableBrowserHeaders = result.headers;
		core.view.selectionDataTable = [];

		if (result.rows.length === 0)
			core.setToast('info', 'Selected DB2 has no rows.', null);
		else
			core.hideToast(false);

		core.view.tableBrowserRows = result.rows;
		selected_file = table_name;
		selected_file_schema = result.schema;
	} catch (e) {
		core.setToast('error', 'Unable to open DB2 file ' + table_name, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to open CASC file: %s', e.message);
	}
};

export default {
	register() {
		this.registerNavButton('Data', 'database.svg', InstallType.CASC);
	},

	data() {
		return { active_table: '' };
	},

	template: `
		<div class="tab list-tab" id="tab-data">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionDB2s" :items="$core.view.dbdManifest" :filter="$core.view.userInputFilterDB2s" :keyinput="true"
					:regex="$core.view.config.regexFilters" :copydir="$core.view.config.copyFileDirectories" :pasteselection="$core.view.config.pasteSelection"
					:copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="false" unittype="db2 file" :nocopy="true"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterDB2s" placeholder="Filter DB2s.." />
			</div>
			<div class="list-container">
				<component ref="dataTable" :is="$components.DataTable" :headers="$core.view.tableBrowserHeaders" :rows="$core.view.tableBrowserRows" :filter="$core.view.userInputFilterDataTable" :regex="$core.view.config.regexFilters" :selection="$core.view.selectionDataTable" :copyheader="$core.view.config.dataCopyHeader" :tablename="active_table" @update:filter="$core.view.userInputFilterDataTable = $event" @update:selection="$core.view.selectionDataTable = $event" @contextmenu="handle_context_menu" @copy="copy_rows_csv"></component>
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
				<component :is="$components.MenuButton" :options="$core.view.menuButtonData" :default="$core.view.config.exportDataFormat" @change="$core.view.config.exportDataFormat = $event" class="upward" :disabled="$core.view.isBusy || $core.view.selectionDB2s.length === 0" @click="export_data"></component>
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

		async initialize() {
			this.$core.showLoadingScreen(1);
			await this.$core.progressLoadingScreen('Loading data table manifest...');
			await initialize_available_tables(this.$core);
			this.$core.hideLoadingScreen();
		},

		async export_data() {
			const format = this.$core.view.config.exportDataFormat;

			if (format === 'CSV')
				await this.export_csv();
			else if (format === 'SQL')
				await this.export_sql();
			else if (format === 'DB2')
				await this.export_db2();
		},

		async export_csv() {
			const user_selection = this.$core.view.selectionDB2s;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any tables to export.');
				return;
			}

			if (user_selection.length === 1) {
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
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'table');
			helper.start();

			const export_paths = this.$core.openLastExportStream();

			for (const table_name of user_selection) {
				if (helper.isCancelled())
					break;

				try {
					const result = await parse_table(table_name);
					await dataExporter.exportDataTable(result.headers, result.rows, table_name, { helper, export_paths });
				} catch (e) {
					helper.mark(table_name + '.csv', false, e.message, e.stack);
					log.write('Failed to export table %s: %s', table_name, e.message);
				}
			}

			export_paths?.close();
			helper.finish();
		},

		async export_sql() {
			const user_selection = this.$core.view.selectionDB2s;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any tables to export.');
				return;
			}

			const create_table = this.$core.view.config.dataSQLCreateTable;

			if (user_selection.length === 1) {
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

				await dataExporter.exportDataTableSQL(headers, rows_to_export, selected_file || 'unknown_table', selected_file_schema, create_table);
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'table');
			helper.start();

			const export_paths = this.$core.openLastExportStream();

			for (const table_name of user_selection) {
				if (helper.isCancelled())
					break;

				try {
					const result = await parse_table(table_name);
					await dataExporter.exportDataTableSQL(result.headers, result.rows, table_name, result.schema, create_table, { helper, export_paths });
				} catch (e) {
					helper.mark(table_name + '.sql', false, e.message, e.stack);
					log.write('Failed to export table %s: %s', table_name, e.message);
				}
			}

			export_paths?.close();
			helper.finish();
		},

		async export_db2() {
			const user_selection = this.$core.view.selectionDB2s;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'No DB2 files selected to export.');
				return;
			}

			if (user_selection.length === 1) {
				if (!selected_file || !selected_file_data_id) {
					this.$core.setToast('info', 'No DB2 file selected to export.');
					return;
				}

				await dataExporter.exportRawDB2(selected_file, selected_file_data_id);
				return;
			}

			const helper = new ExportHelper(user_selection.length, 'db2');
			helper.start();

			const export_paths = this.$core.openLastExportStream();

			for (const table_name of user_selection) {
				if (helper.isCancelled())
					break;

				try {
					const file_data_id = null;
					if (!file_data_id)
						throw new Error('No file data ID found for table ' + table_name);

					await dataExporter.exportRawDB2(table_name, file_data_id, { helper, export_paths });
				} catch (e) {
					helper.mark(table_name + '.db2', false, e.message, e.stack);
					log.write('Failed to export DB2 %s: %s', table_name, e.message);
				}
			}

			export_paths?.close();
			helper.finish();
		}
	},

	async mounted() {
		await this.initialize();

		this.$core.view.$watch('selectionDB2s', async selection => {
			const last = selection[selection.length - 1];
			if (!this.$core.view.isBusy && last && selected_file !== last) {
				await load_table(this.$core, last);
				this.active_table = selected_file;
			}
		});
	}
};
