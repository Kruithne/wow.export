/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const WDCReader = require('../db/WDCReader');
const path = require('path');
const generics = require('../generics');

let selectedFile = null;

/**
 * Initialize the available table names by fetching the DBD repository.
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
		const root = raw.readJSON();

		for (const entry of root.tree) {
			if (entry.path.startsWith('definitions/') && entry.path.endsWith('.dbd')) {
				const name = path.basename(entry.path, '.dbd');
				manifest.push(name);
			}
		}

		manifest.sort();
		log.write('Initialized %d available DB2 tables from DBD repository', dbdManifest.length);
	} catch (e) {
		log.write('Failed to initialize available DB2 tables: %s', e.message);
	}
}

core.registerLoadFunc(async () => {
	await initializeAvailableTables();
	
	// Track selection changes on the text listbox and set first as active entry.
	core.view.$watch('selectionDB2s', async selection => {
		// Check if the first table in the selection is "new".
		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first) {
			try {
				// Use the table name directly (already in proper case from DBD repository)
				const tableName = first;
				
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
