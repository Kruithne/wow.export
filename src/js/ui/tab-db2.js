/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const generics = require('../generics');
const util = require('util');
const listfile = require('../casc/listfile');
const WDCReader = require('../db/WDCReader');
const path = require('path');

let selectedFile = null;
let db2NameMap = undefined;

core.registerLoadFunc(async () => {
	log.write('Downloading DB2 filename mapping from %s', "https://api.wow.tools/databases/");
	generics.getJSON("https://api.wow.tools/databases/").then(raw => db2NameMap = raw);

	// Track selection changes on the text listbox and set first as active entry.
	core.view.$watch('selectionDB2s', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (!core.view.isBusy && first && selectedFile !== first && db2NameMap !== undefined) {
			try {
				const lowercaseTableName = path.basename(first, '.db2')
				const tableName = db2NameMap.find(e => e.name == lowercaseTableName)?.displayName;

				const db2Reader = new WDCReader('DBFilesClient/' + tableName + '.db2');
				await db2Reader.parse();
				
				core.view.tableBrowserHeaders = [...db2Reader.schema.keys()];

				const rows = db2Reader.getAllRows();
				if (rows.size == 0) 
					core.setToast('info', 'Selected DB2 has no rows.', null);
				else 
					core.hideToast(false);

				const parsed = Array(rows.size);

				let index = 0;
				for (const row of rows.values())
					parsed[index++] = Object.values(row);

				core.view.tableBrowserRows = parsed;

				selectedFile = first;
			} catch (e) {
				// Error reading/parsing DB2 file.
				core.setToast('error', 'Unable to open DB2 file ' + first, { 'View Log': () => log.openRuntimeLog() }, -1);
				log.write('Failed to open CASC file: %s', e.message);
			}
		}
	});
});
