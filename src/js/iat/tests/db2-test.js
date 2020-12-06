/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const assert = require('assert');
const path = require('path');
const util = require('util');

const IntegrationTest = require('../integration-test');
const WDCReader = require('../../db/WDCReader');
const listfile = require('../../casc/listfile');
const generics = require('../../generics');
const log = require('../../log');

/**
 * Defines the DBD repository tree used to match DBD file names.
 * @type {string}
 */
const DBD_REPO_TREE = 'https://api.github.com/repos/wowdev/WoWDBDefs/git/trees/master?recursive=1';

/**
 * Defines the base URL for DB validation files.
 * @type {string}
 */
const DB_DATA_URL = 'https://wow.tools/dbc/cachedexports/';

/**
 * Defines the URL at which DB validation files are found.
 * @type {string}
 */
const DB_DATA_CSV_URL = DB_DATA_URL;

/**
 * Defines the URL at which a data validation manifest is found.
 * Format token is the build ID.
 * @type {string}
 */
const DB_DATA_MANIFEST = DB_DATA_URL + '%s.json';

/**
 * Defines the file name format for a data validation CSV.
 * Format tokens are the tableName and CSV MD5 hash.
 * @type {string}
 */
const DB_DATA_CSV = '%s.%s.csv';

class DB2Test extends IntegrationTest {
	/**
	 * DB2Test constructor.
	 * @param {TestRunner} runner 
	 * @param {CASC} casc
	 */
	constructor(runner, casc) {
		super(runner, casc);
		this._tests = [];
	}

	/**
	 * Initialize the testing unit.
	 */
	async init() {
		// This map is used to map lowercase DB2 file names to cased DBD names.
		this.dbdMap = new Map();

		// Download the DBD repo tree and parse it for entry names.
		const raw = await generics.downloadFile(DBD_REPO_TREE);
		const root = raw.readJSON();

		for (const entry of root.tree) {
			if (entry.path.startsWith('definitions/')) {
				const name = path.basename(entry.path, '.dbd');
				this.dbdMap.set(name.toLowerCase(), name);
			}
		}

		// For every DB2 file in the listfile, generate a test function.
		const tables = listfile.getFilenamesByExtension('.db2');
		for (const table of tables) {
			const tableName = 'testTable_' + path.basename(table);
			this._tests.push({[tableName]: async () => await this.testTable(table)}[tableName]);
		}

		// Download data validation manifest for this build.
		this.validationMap = new Map();
		const manifestURL = util.format(DB_DATA_MANIFEST, this.casc.getBuildKey());
		const manifest = (await generics.downloadFile(manifestURL)).readJSON();

		for (const [csvName, csvHash] of Object.entries(manifest.entries))
			this.validationMap.set(csvName, csvHash);
	}

	/**
	 * Returns true if a test unit requires a CASC instance provided as the
	 * second parameter. If false, this test unit will be automatically skipped
	 * if CASC has not been initialized.
	 */
	static get requireCASC() {
		return true;
	}

	/**
	 * Returns the individual tests for this test unit.
	 * @returns {function[]}
	 */
	get tests() {
		return this._tests;
	}

	/**
	 * Test an individual data table.
	 * @param {string} file 
	 */
	async testTable(file) {
		const tableName = path.basename(file, '.db2');
		const dbdName = this.dbdMap.get(tableName);

		if (dbdName === undefined)
			throw new Error('Unable to locate DBD for ' + dbdName);

		const table = new WDCReader('DBFilesClient/' + dbdName + '.db2');
		await table.parse();

		const csvHash = this.validationMap.get(tableName);
		if (csvHash === undefined)
			throw new Error('No entry for' + tableName + ' in data validation manifest');

		const csvFile = util.format(DB_DATA_CSV, tableName, csvHash);
		let rawCsv = await this.casc.cache.getFile(csvFile);

		if (rawCsv === null) {
			const csvUrl = DB_DATA_CSV_URL + csvFile;
			log.write('DB2 validation file not cached, downloading from %s', csvUrl);

			rawCsv = await generics.downloadFile(csvUrl);
			this.casc.cache.storeFile(csvFile, rawCsv);
		} else {
			log.write('Using DB2 validation file %s from cache', csvFile);
		}

		const csvLines = rawCsv.readLines();

		let checkHeader = [];
		for (const [fieldName, fieldType] of table.schema) {
			if (Array.isArray(fieldType)) {
				// Format array field headers as FieldName[5]
				for (let i = 0; i < fieldType[1]; i++) 
					checkHeader.push(util.format('%s[%d]', fieldName, i));
			} else {
				// Format normal fields as just their name.
				checkHeader.push(fieldName);
			}
		}

		// Validate the schema against the CSV header (first line).
		assert.strictEqual(checkHeader.join(','), csvLines.shift(), 'DB2 schema does not match expected header');

		var quotableChars = [',', '"', '\r', '\n'];

		for (const [rowID, row] of table.getAllRows()) {
			let checkRow = Array();
			// const checkRow = Object.values(row).map(e => { e = e.toString(); return e.includes(',') ? '"' + e + '"' : e; });
			
			for (const [fieldName, fieldType] of table.schema) {
				if (Array.isArray(fieldType)) {
					for (let i = 0; i < fieldType[1]; i++) {
						const fieldValue = row[fieldName][i].toString();
						if (quotableChars.some(quotableChar => fieldValue.includes(quotableChar))) 
							checkRow.push('"' + fieldValue.replace('"', '\\"') + '"');
						 else 
							checkRow.push(fieldValue);
					}
				} else {
					const fieldValue = row[fieldName].toString();
					if (quotableChars.some(quotableChar => fieldValue.includes(quotableChar))) 
						checkRow.push('"' + fieldValue.replace('"', '\\"') + '"');
					else 
						checkRow.push(fieldValue);
				}
			}
			assert.strictEqual(checkRow.join(','), csvLines.shift(), 'DB2 row does not match CSV');
		}
	}
}

module.exports = DB2Test;