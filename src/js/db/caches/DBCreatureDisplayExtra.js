/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../../log');
const db2 = require('../../casc/db2');

const extra_map = new Map();
const option_map = new Map();

let is_initialized = false;
let init_promise = null;

const ensureInitialized = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = _initialize();
	await init_promise;
};

const _initialize = async () => {
	log.write('Loading creature display extra data...');

	for (const [id, row] of await db2.CreatureDisplayInfoExtra.getAllRows()) {
		extra_map.set(id, {
			DisplayRaceID: row.DisplayRaceID,
			DisplaySexID: row.DisplaySexID,
			DisplayClassID: row.DisplayClassID,
			BakeMaterialResourcesID: row.BakeMaterialResourcesID,
			HDBakeMaterialResourcesID: row.HDBakeMaterialResourcesID
		});
	}

	for (const row of (await db2.CreatureDisplayInfoOption.getAllRows()).values()) {
		const extra_id = row.CreatureDisplayInfoExtraID;
		if (!option_map.has(extra_id))
			option_map.set(extra_id, []);

		option_map.get(extra_id).push({
			optionID: row.ChrCustomizationOptionID,
			choiceID: row.ChrCustomizationChoiceID
		});
	}

	log.write('Loaded %d creature display extras, %d with customization options', extra_map.size, option_map.size);
	is_initialized = true;
	init_promise = null;
};

const get_extra = (id) => extra_map.get(id);

const get_customization_choices = (extra_id) => option_map.get(extra_id) ?? [];

module.exports = {
	ensureInitialized,
	get_extra,
	get_customization_choices
};
