const util = require('util');
const core = require('../core');

const DBHandler = require('../db/DBHandler');
const DB_Map = require('../db/schema/Map');

// The first time the user opens up the map tab, initialize map names.
core.events.once('screen-tab-maps', async () => {
	core.view.isBusy++;
	core.setToast('progress', 'Checking for available maps, hold on...', null, -1, false);

	const table = await DBHandler.openTable('dbfilesclient/map.db2', DB_Map);
	console.log(table);

	const maps = [];
	for (const [id, entry] of table.rows)
		maps.push(util.format('[%d]\31%s\31(%s)', id, entry.MapName, entry.Directory));

	core.view.mapViewerMaps = maps;
	
	core.hideToast();
	core.view.isBusy--;
});