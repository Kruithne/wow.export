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
const FieldType = require('../../db/FieldType');
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
const DB_DATA_JSON_URL = DB_DATA_URL;

/**
 * Defines the URL at which a data validation manifest is found.
 * Format token is the build ID.
 * @type {string}
 */
const DB_DATA_MANIFEST = DB_DATA_URL + '%s.json';

/**
 * Defines the file name format for a data validation JSON.
 * Format tokens are the tableName and JSON MD5 hash.
 * @type {string}
 */
const DB_DATA_JSON = '%s.%s.json';

/**
 * Tables to skip, these tables should only be skipped due to having unsupported unicode characters (our fault) or issues on Blizz's end (not our fault).
 */
const FILTERED_DBS = ["chatprofanity.db2", "namesprofanity.db2", "namesreserved.db2", "spell.db2", "unittestsparse.db2"];

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
		for (let table of tables) {
			table = table.split(" [")[0];
			const tableName = 'testTable_' + path.basename(table);

			if (FILTERED_DBS.includes(path.basename(table))) {
				console.log("Skipping " + tableName + " due to it being filtered out for having unsupported unicode characters.");
				continue;
			}

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
			throw new Error('Unable to locate DBD for ' + tableName);

		const table = new WDCReader('DBFilesClient/' + dbdName + '.db2');
		await table.parse();

		const jsonHash = this.validationMap.get(tableName);
		if (jsonHash === undefined)
			throw new Error('No entry for' + tableName + ' in data validation manifest');

		const jsonFile = util.format(DB_DATA_JSON, tableName, jsonHash);
		let rawJson = await this.casc.cache.getFile(jsonFile);

		if (rawJson === null) {
			const jsonUrl = DB_DATA_JSON_URL + jsonFile;
			log.write('DB2 validation file not cached, downloading from %s', jsonUrl);

			rawJson = await generics.downloadFile(jsonUrl);
			this.casc.cache.storeFile(jsonFile, rawJson);
		} else {
			log.write('Using DB2 validation file %s from cache', jsonFile);
		}

		const db2json = rawJson.readJSON().data;

		var entities = {
			'amp': '&',
			'apos': '\'',
			'#x27': '\'',
			'#x2F': '/',
			'#39': '\'',
			'#47': '/',
			'#160': ' ',
			'#163': '£',
			'#165': '¥',
			'#223': 'ß',
			'#228': 'ä',
			'#233': 'é',
			'#241': 'ñ',
			'#246': 'ö',
			'#252': 'ü',
			'lt': '<',
			'gt': '>',
			'nbsp': ' ',
			'quot': '"'
		}

		var idIndex = table.getIDIndex();

		if (idIndex == null) 
			assert.fail("No ID col, NYI");
		
		table.getAllRows();

		for (const row of db2json) {
			let checkRow = Array();
			// const checkRow = Object.values(row).map(e => { e = e.toString(); return e.includes(',') ? '"' + e + '"' : e; });
			
			for (const [key, val] of Object.entries(row)) 
				row[key] = val.replace(/&([^;]+);/gm, function (match, entity) { return entities[entity] || match  });
			
			let colIndex = 0;
			let ourColIndex = 0;
			let actualIDIndex = 0;
			for (const [fieldName, fieldType] of table.schema) {
				if (idIndex == ourColIndex) 
					actualIDIndex = colIndex;

				if (Array.isArray(fieldType)) {
					for (let i = 0; i < fieldType[1]; i++) 
						colIndex++;
				} else {
					colIndex++;
				}

				ourColIndex++;
			}

			var ourRow = table.getRow(row[actualIDIndex]);
			if (ourRow === null) 
				assert.fail("No row returned for ID " + row[actualIDIndex]);
			
			let anotherColIndex = 0;
			for (const [fieldName, fieldType] of table.schema) {
				if (Array.isArray(fieldType)) {
					for (let i = 0; i < fieldType[1]; i++) {
						if (fieldType[0] == FieldType.Float) {
							// TODO: Float range checks
							const fieldValue = 0;
							checkRow.push(fieldValue);
							row[anotherColIndex] = 0;
						} else {
							const fieldValue = ourRow[fieldName][i].toString();
							checkRow.push(fieldValue);
						}

						anotherColIndex++;
					}
				} else {
					if (fieldType == FieldType.Float) {
						// TODO: Float range checks
						const fieldValue = 0;
						checkRow.push(fieldValue);
						row[anotherColIndex] = 0;
					} else {
						const fieldValue = ourRow[fieldName].toString();
						checkRow.push(fieldValue);
					}

					anotherColIndex++;
				}
			}

			assert.deepStrictEqual(checkRow, row, 'DB2 row does not match,\nWE: ' + checkRow + '\nWT: ' + row + '\n');
		}
	}
}

module.exports = DB2Test;