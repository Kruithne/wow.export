/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const WDCReader = require('../db/WDCReader');
const generics = require('../generics');
const dataExporter = require('./data-exporter');

let selectedFile = null;
let selectedFileDataID = null;
let manifestLookup = new Map();

/**
 * Initialize the available table names by fetching the DBD manifest.
 * @returns {Promise<void>}
 */
async function initializeAvailableTables() {
	const manifest = core.view.dbdManifest;
	if (manifest.length > 0)
		return;

	try {
		const dbdFilenameURL = core.view.config.dbdFilenameURL;
		const dbdFilenameFallbackURL = core.view.config.dbdFilenameFallbackURL;
		
		const raw = await generics.downloadFile([dbdFilenameURL, dbdFilenameFallbackURL]);
		const manifestData = raw.readJSON();

		for (const entry of manifestData) {
			if (entry.tableName && entry.db2FileDataID) {
				if (!core.view.casc.fileExists(entry.db2FileDataID))
					continue;
				
				manifest.push(entry.tableName);
				manifestLookup.set(entry.tableName, entry.db2FileDataID);
			}
		}

		manifest.sort();
		log.write('Initialized %d available DB2 tables from DBD manifest', manifest.length);
	} catch (e) {
		log.write('Failed to initialize available DB2 tables: %s', e.message);
	}
}

// Initialize data tab on first open
core.events.once('screen-tab-data', async () => {
	// Show loading screen for data table manifest
	const progress = core.createProgress(1);
	core.view.setScreen('loading');
	core.view.isBusy++;

	try {
		await progress.step('Loading data table manifest...');
		await initializeAvailableTables();
		
		core.view.isBusy--;
		core.view.setScreen('tab-data');
	} catch (error) {
		core.view.isBusy--;
		core.view.setScreen('tab-data');
		log.write('Failed to initialize data tab: %o', error);
		core.setToast('error', 'Failed to load data table manifest. Check the log for details.');
	}
});

core.registerLoadFunc(async () => {
	// Track selection changes on the text listbox and set first as active entry.
	core.view.$watch('selectionDB2s', async selection => {
		// Check if the first table in the selection is "new".
		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first) {
			try {
				// Use the table name directly (already in proper case from DBD repository)
				const tableName = first;
				
				// Get the fileDataID for this table from our lookup
				selectedFileDataID = manifestLookup.get(tableName) || null;
				
				const db2Reader = new WDCReader('DBFilesClient/' + tableName + '.db2');
				await db2Reader.parse();

				const allHeaders = [...db2Reader.schema.keys()];
				const idIndex = allHeaders.findIndex(header => header.toUpperCase() === 'ID');
				if (idIndex > 0) {
					const idHeader = allHeaders.splice(idIndex, 1)[0];
					allHeaders.unshift(idHeader);
				}

				core.view.tableBrowserHeaders = allHeaders;
				core.view.selectionDataTable = [];

				const rows = await db2Reader.getAllRows();
				if (rows.size == 0) 
					core.setToast('info', 'Selected DB2 has no rows.', null);
				else 
					core.hideToast(false);

				const parsed = Array(rows.size);

				let index = 0;
				for (const row of rows.values()) {
					const rowValues = Object.values(row);
					if (idIndex > 0) {
						const idValue = rowValues.splice(idIndex, 1)[0];
						rowValues.unshift(idValue);
					}

					parsed[index++] = rowValues;
				}

				core.view.tableBrowserRows = parsed;

				selectedFile = first;
			} catch (e) {
				// Error reading/parsing DB2 file.
				core.setToast('error', 'Unable to open DB2 file ' + first, { 'View Log': () => log.openRuntimeLog() }, -1);
				log.write('Failed to open CASC file: %s', e.message);
			}
		}
	});

	// Track when the user clicks to export data table as CSV.
	core.events.on('click-export-data-csv', async () => {
		const headers = core.view.tableBrowserHeaders;
		const allRows = core.view.tableBrowserRows;
		const selection = core.view.selectionDataTable;
		const exportAll = core.view.config.dataExportAll;
		
		if (!headers || !allRows || headers.length === 0 || allRows.length === 0) {
			core.setToast('info', 'No data table loaded to export.');
			return;
		}

		let rowsToExport;
		if (exportAll) {
			rowsToExport = allRows;
		} else {
			if (!selection || selection.length === 0) {
				core.setToast('info', 'No rows selected. Please select some rows first or enable "Export all rows".');
				return;
			}
			
			rowsToExport = selection.map(rowIndex => allRows[rowIndex]).filter(row => row !== undefined);
			if (rowsToExport.length === 0) {
				core.setToast('info', 'No rows selected. Please select some rows first or enable "Export all rows".');
				return;
			}
		}
		
		await dataExporter.exportDataTable(headers, rowsToExport, selectedFile || 'unknown_table');
	});

	// Track when the user clicks to export raw DB2 file.
	core.events.on('click-export-db2-raw', async () => {
		if (!selectedFile || !selectedFileDataID) {
			core.setToast('info', 'No DB2 file selected to export.');
			return;
		}
		
		await dataExporter.exportRawDB2(selectedFile, selectedFileDataID);
	});
});
