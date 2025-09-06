/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const generics = require('../generics');
const ExportHelper = require('../casc/export-helper');
const CSVWriter = require('../3D/writers/CSVWriter');
const fsp = require('fs').promises;

/**
 * Export data table to CSV format.
 * @param {Array} headers - Array of column headers
 * @param {Array} rows - Array of row data arrays
 * @param {string} tableName - Name of the table being exported
 */
const exportDataTable = async (headers, rows, tableName) => {
	if (!headers || !rows || headers.length === 0 || rows.length === 0) {
		core.setToast('info', 'No data available to export.');
		return;
	}

	const helper = new ExportHelper(1, 'table');
	helper.start();

	const exportPaths = core.openLastExportStream();

	try {
		const fileName = `${tableName}.csv`;
		const exportPath = ExportHelper.getExportPath(fileName);

		const overwriteFiles = core.view.config.overwriteFiles;
		if (!overwriteFiles && await generics.fileExists(exportPath)) {
			log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			helper.mark(fileName, true);
		} else {
			const csvWriter = new CSVWriter(exportPath);

			csvWriter.addField(...headers);

			for (const row of rows) {
				const rowObject = {};
				for (let i = 0; i < headers.length; i++) {
					const value = row[i];
					rowObject[headers[i]] = value !== null && value !== undefined ? value.toString() : '';
				}
				csvWriter.addRow(rowObject);
			}

			await csvWriter.write(overwriteFiles);
			await exportPaths?.writeLine('CSV:' + exportPath);

			helper.mark(fileName, true);
			log.write('Successfully exported data table to %s', exportPath);
		}
	} catch (e) {
		const fileName = `${tableName}.csv`;
		helper.mark(fileName, false, e.message, e.stack);
		log.write('Failed to export data table: %s', e.message);
	}

	exportPaths?.close();
	helper.finish();
};

/**
 * Export raw DB2 file directly from CASC.
 * @param {string} tableName - Name of the table being exported
 * @param {number} fileDataID - File data ID of the DB2 file
 */
const exportRawDB2 = async (tableName, fileDataID) => {
	if (!tableName || !fileDataID) {
		core.setToast('info', 'No DB2 file information available to export.');
		return;
	}

	const helper = new ExportHelper(1, 'db2');
	helper.start();

	const exportPaths = core.openLastExportStream();

	try {
		const fileName = `${tableName}.db2`;
		const exportPath = ExportHelper.getExportPath(fileName);

		const overwriteFiles = core.view.config.overwriteFiles;
		if (!overwriteFiles && await generics.fileExists(exportPath)) {
			log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			helper.mark(fileName, true);
		} else {
			const fileData = await core.view.casc.getFile(fileDataID);
			if (!fileData) {
				throw new Error('Failed to retrieve DB2 file from CASC');
			}

			await fileData.writeToFile(exportPath);
			await exportPaths?.writeLine('DB2:' + exportPath);

			helper.mark(fileName, true);
			log.write('Successfully exported raw DB2 file to %s', exportPath);
		}
	} catch (e) {
		const fileName = `${tableName}.db2`;
		helper.mark(fileName, false, e.message, e.stack);
		log.write('Failed to export raw DB2 file: %s', e.message);
	}

	exportPaths?.close();
	helper.finish();
};

module.exports = { exportDataTable, exportRawDB2 };