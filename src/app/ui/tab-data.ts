/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import { watch } from 'vue';

import { state, setToast, hideToast } from '../core';
import Events from '../events';
import Log from '../log';
import Listfile from '../casc/listfile';
import WDCReader from '../db/WDCReader';

import { get } from '../generics';

let selectedFile: string;

Events.once('casc:initialized', async () => {
	// TODO: Cache manifest with sane expiry (e.g. same as DBD) instead of requesting each time
	const manifestURL = util.format(state.config.dbdURL, 'manifest');
	Log.write('Downloading DB2 filename mapping from %s', manifestURL);
	const db2NameMap = await get(manifestURL).then(res => res.json());

	// Track selection changes on the text listbox and set first as active entry.
	watch(() => state.selectionDB2s, async selection => {
		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (!state.isBusy && first && selectedFile !== first && db2NameMap !== undefined) {
			try {
				const lowercaseTableName = path.basename(first, '.db2');
				const tableName = db2NameMap.find(e => e.tableName.toLowerCase() == lowercaseTableName)?.tableName;

				const db2Reader = new WDCReader('DBFilesClient/' + tableName + '.db2');
				await db2Reader.parse();

				state.tableBrowserHeaders = [...db2Reader.schema.keys()];

				const rows = db2Reader.getAllRows();
				if (rows.size == 0)
					setToast('info', 'Selected DB2 has no rows.', null);
				else
					hideToast(false);

				const parsed = Array(rows.size);

				let index = 0;
				for (const row of rows.values())
					parsed[index++] = Object.values(row);

				state.tableBrowserRows = parsed;

				selectedFile = first;
			} catch (e) {
				// Error reading/parsing DB2 file.
				setToast('error', 'Unable to open DB2 file ' + first, { 'View Log': () => Log.openRuntimeLog() }, -1);
				Log.write('Failed to open CASC file: %s', e.message);
			}
		}
	}, { deep: true });
});