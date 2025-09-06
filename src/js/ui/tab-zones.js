/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const util = require('util');
const core = require('../core');
const log = require('../log');
const WDCReader = require('../db/WDCReader');

let selectedZoneID;

/**
 * Parse a zone entry from the listbox.
 * @param {string} entry 
 */
const parseZoneEntry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('Unexpected zone entry');

	return { id: parseInt(match[1]), zoneName: match[2], areaName: match[3] };
};

// The first time the user opens the zones tab, initialize zone data.
core.events.once('screen-tab-zones', async () => {
	core.view.isBusy++;
	core.setToast('progress', 'Loading zone data, please wait...', null, -1, false);

	try {
		const mapTable = new WDCReader('DBFilesClient/Map.db2');
		await mapTable.parse();
		
		const expansionMap = new Map();
		for (const [id, entry] of mapTable.getAllRows())
			expansionMap.set(id, entry.ExpansionID);
		
		log.write('Loaded %d maps for expansion mapping', expansionMap.size);

		const table = new WDCReader('DBFilesClient/AreaTable.db2');
		await table.parse();

		const zones = [];
		for (const [id, entry] of table.getAllRows()) {
			const expansionId = expansionMap.get(entry.ContinentID) || 0;
			
			// Format: ExpansionID\x19[ID]\x19ZoneName\x19(AreaName_lang)
			zones.push(
				util.format('%d\x19[%d]\x19%s\x19(%s)',
				expansionId, id, entry.AreaName_lang, entry.ZoneName)
			);
		}

		core.view.zoneViewerZones = zones;
		log.write('Loaded %d zones from AreaTable', zones.length);
		
		core.hideToast();
	} catch (e) {
		core.setToast('error', 'Failed to load zone data: ' + e.message, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load AreaTable.db2: %s', e.message);
	}

	core.view.isBusy--;
});

core.registerLoadFunc(async () => {
	// Track selection changes on the zones listbox.
	core.view.$watch('selectionZones', async selection => {
		// Check if the first file in the selection is "new".
		const first = selection[0];

		if (!core.view.isBusy && first) {
			const zone = parseZoneEntry(first);
			if (selectedZoneID !== zone.id) {
				selectedZoneID = zone.id;
				log.write('Selected zone: %s (%d)', zone.zoneName, zone.id);
			}
		}
	});
});