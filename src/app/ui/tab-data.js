/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
const util = require('util');
const core = require('../core');
const log = require('../log');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const WDCReader = require('../db/WDCReader');
const HTFXReader = require('../db/HTFXReader');
const path = require('path');

let selectedFile = null;
let db2NameMap = undefined;

core.registerLoadFunc(async () => {
	// TODO: Cache manifest with sane expiry (e.g. same as DBD) instead of requesting each time
	const manifestURL = util.format(core.view.config.dbdURL, "manifest");
	log.write('Downloading DB2 filename mapping from %s', manifestURL);
	const db2NameMap = await generics.getJSON(manifestURL);

	if (core.view.config.hotfixesEnabled){
		let htfxReader = new HTFXReader(db2NameMap);
		htfxReader.parse();
	}

	// Track selection changes on the text listbox and set first as active entry.
	core.view.$watch('selectionDB2s', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (!core.view.isBusy && first && selectedFile !== first && db2NameMap !== undefined) {
			try {
				const lowercaseTableName = path.basename(first, '.db2');
				const tableName = db2NameMap.find(e => e.tableName.toLowerCase() == lowercaseTableName)?.tableName;

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
