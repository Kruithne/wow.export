/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const assert = require('assert');
const IntegrationTest = require('../integration-test');
const WDCReader = require('../../db/WDCReader');
const listfile = require('../../casc/listfile');
const generics = require('../../generics');
const path = require('path');

const DBD_REPO_TREE = 'https://api.github.com/repos/wowdev/WoWDBDefs/git/trees/master?recursive=1';

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

		console.log(this.dbdMap);

		const tables = listfile.getFilenamesByExtension('.db2');
		for (const table of tables) {
			const tableName = 'testTable_' + path.basename(table);
			this._tests.push({[tableName]: async () => await this.testTable(table)}[tableName]);
		}
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
	}
}

module.exports = DB2Test;