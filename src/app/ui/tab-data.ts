/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import State from '../state';
import Events from '../events';
import * as listfile from '../casc/listfile';
import * as log from '../log';
import * as generics from '../generics';
import WDCReader from '../db/WDCReader';

let selectedFile: string;

Events.once('casc-ready', async () => {
	// TODO: Cache manifest with sane expiry (e.g. same as DBD) instead of requesting each time
	const manifestURL = util.format(State.state.config.dbdURL, 'manifest');
	log.write('Downloading DB2 filename mapping from %s', manifestURL);
	const db2NameMap = await generics.get(manifestURL).then(res => res.json());

	// Track selection changes on the text listbox and set first as active entry.
	State.state.$watch('selectionDB2s', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (!State.state.isBusy && first && selectedFile !== first && db2NameMap !== undefined) {
			try {
				const lowercaseTableName = path.basename(first, '.db2');
				const tableName = db2NameMap.find(e => e.tableName.toLowerCase() == lowercaseTableName)?.tableName;

				const db2Reader = new WDCReader('DBFilesClient/' + tableName + '.db2');
				await db2Reader.parse();

				State.state.tableBrowserHeaders = [...db2Reader.schema.keys()];

				const rows = db2Reader.getAllRows();
				if (rows.size == 0)
					State.state.setToast('info', 'Selected DB2 has no rows.', null);
				else
					State.state.hideToast(false);

				const parsed = Array(rows.size);

				let index = 0;
				for (const row of rows.values())
					parsed[index++] = Object.values(row);

				State.state.tableBrowserRows = parsed;

				selectedFile = first;
			} catch (e) {
				// Error reading/parsing DB2 file.
				State.state.setToast('error', 'Unable to open DB2 file ' + first, { 'View Log': () => log.openRuntimeLog() }, -1);
				log.write('Failed to open CASC file: %s', e.message);
			}
		}
	});
});