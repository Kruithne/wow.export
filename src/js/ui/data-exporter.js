/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import core from '../core.js';
import log from '../log.js';
import generics from '../generics.js';
import { exporter as ExportHelper } from '../../views/main/rpc.js';
import CSVWriter from '../3D/writers/CSVWriter.js';
import SQLWriter from '../3D/writers/SQLWriter.js';
import BufferWrapper from '../buffer.js';

/**
 * Export data table to CSV format.
 * @param {Array} headers - Array of column headers
 * @param {Array} rows - Array of row data arrays
 * @param {string} tableName - Name of the table being exported
 */
const exportDataTable = async (headers, rows, tableName, options = {}) => {
	if (!headers || !rows || headers.length === 0 || rows.length === 0) {
		if (!options.helper)
			core.setToast('info', 'No data available to export.');

		return;
	}

	const standalone = !options.helper;
	let helper, exportPaths;

	if (standalone) {
		helper = new ExportHelper(1, 'table');
		helper.start();
		exportPaths = core.openLastExportStream();
	} else {
		helper = options.helper;
		exportPaths = options.export_paths;
	}

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

	if (standalone) {
		exportPaths?.close();
		helper.finish();
	}
};

/**
 * Export raw DB2 file directly from CASC.
 * @param {string} tableName - Name of the table being exported
 * @param {number} fileDataID - File data ID of the DB2 file
 */
const exportRawDB2 = async (tableName, fileDataID, options = {}) => {
	if (!tableName || !fileDataID) {
		if (!options.helper)
			core.setToast('info', 'No DB2 file information available to export.');

		return;
	}

	const standalone = !options.helper;
	let helper, exportPaths;

	if (standalone) {
		helper = new ExportHelper(1, 'db2');
		helper.start();
		exportPaths = core.openLastExportStream();
	} else {
		helper = options.helper;
		exportPaths = options.export_paths;
	}

	try {
		const fileName = `${tableName}.db2`;
		const exportPath = ExportHelper.getExportPath(fileName);

		const overwriteFiles = core.view.config.overwriteFiles;
		if (!overwriteFiles && await generics.fileExists(exportPath)) {
			log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			helper.mark(fileName, true);
		} else {
			const fileData = await core.view.casc.getFile(fileDataID, true);
			if (!fileData)
				throw new Error('Failed to retrieve DB2 file from CASC');

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

	if (standalone) {
		exportPaths?.close();
		helper.finish();
	}
};

/**
 * Export data table to SQL format.
 * @param {Array} headers - Array of column headers
 * @param {Array} rows - Array of row data arrays
 * @param {string} tableName - Name of the table being exported
 * @param {Map} schema - WDCReader schema map for DDL generation
 * @param {boolean} createTable - Whether to include DROP/CREATE TABLE DDL
 */
const exportDataTableSQL = async (headers, rows, tableName, schema, createTable, options = {}) => {
	if (!headers || !rows || headers.length === 0 || rows.length === 0) {
		if (!options.helper)
			core.setToast('info', 'No data available to export.');

		return;
	}

	const standalone = !options.helper;
	let helper, exportPaths;

	if (standalone) {
		helper = new ExportHelper(1, 'table');
		helper.start();
		exportPaths = core.openLastExportStream();
	} else {
		helper = options.helper;
		exportPaths = options.export_paths;
	}

	try {
		const fileName = `${tableName}.sql`;
		const exportPath = ExportHelper.getExportPath(fileName);

		const overwriteFiles = core.view.config.overwriteFiles;
		if (!overwriteFiles && await generics.fileExists(exportPath)) {
			log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			helper.mark(fileName, true);
		} else {
			const sqlWriter = new SQLWriter(exportPath, tableName);

			if (schema)
				sqlWriter.setSchema(schema);

			sqlWriter.setIncludeDDL(createTable);
			sqlWriter.addField(...headers);

			for (const row of rows) {
				const rowObject = {};
				for (let i = 0; i < headers.length; i++) {
					const value = row[i];
					rowObject[headers[i]] = value !== null && value !== undefined ? value : null;
				}
				sqlWriter.addRow(rowObject);
			}

			await sqlWriter.write(overwriteFiles);
			await exportPaths?.writeLine('SQL:' + exportPath);

			helper.mark(fileName, true);
			log.write('Successfully exported data table to %s', exportPath);
		}
	} catch (e) {
		const fileName = `${tableName}.sql`;
		helper.mark(fileName, false, e.message, e.stack);
		log.write('Failed to export data table: %s', e.message);
	}

	if (standalone) {
		exportPaths?.close();
		helper.finish();
	}
};

/**
 * Export raw DBC file from MPQ archive.
 * @param {string} tableName - Name of the table being exported
 * @param {string} filePath - Full path to the file in MPQ (including MPQ name prefix)
 * @param {MPQInstall} mpq - MPQ install instance
 */
const exportRawDBC = async (tableName, filePath) => {
	if (!tableName || !filePath) {
		core.setToast('info', 'No DBC file information available to export.');
		return;
	}

	const helper = new ExportHelper(1, 'dbc');
	helper.start();

	const exportPaths = core.openLastExportStream();

	try {
		const fileName = `${tableName}.dbc`;
		const exportPath = ExportHelper.getExportPath(fileName);

		const overwriteFiles = core.view.config.overwriteFiles;
		if (!overwriteFiles && await generics.fileExists(exportPath)) {
			log.write('Skipping export of %s (file exists, overwrite disabled)', exportPath);
			helper.mark(fileName, true);
		} else {
			const raw_data = await core.view.mpq.getFile(filePath);

			if (!raw_data)
				throw new Error('Failed to retrieve DBC file from MPQ');

			const export_dir = exportPath.substring(0, exportPath.lastIndexOf('/'));
			await generics.createDirectory(export_dir);

			const buf = BufferWrapper.from(raw_data);
			await buf.writeToFile(exportPath);
			await exportPaths?.writeLine('DBC:' + exportPath);

			helper.mark(fileName, true);
			log.write('Successfully exported raw DBC file to %s', exportPath);
		}
	} catch (e) {
		const fileName = `${tableName}.dbc`;
		helper.mark(fileName, false, e.message, e.stack);
		log.write('Failed to export raw DBC file: %s', e.message);
	}

	exportPaths?.close();
	helper.finish();
};

export { exportDataTable, exportDataTableSQL, exportRawDB2, exportRawDBC };

export default { exportDataTable, exportDataTableSQL, exportRawDB2, exportRawDBC };
