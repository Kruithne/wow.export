import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

const creatures = new Map();
let is_initialized = false;

const initialize_creature_list = async () => {
	if (is_initialized)
		return;

	log.write('Loading creature list...');

	for (const [id, row] of await db2.Creature.getAllRows()) {
		const name = row.Name_lang;
		if (!name || name.length === 0)
			continue;

		let display_id = 0;
		for (const did of row.DisplayID) {
			if (did > 0) {
				display_id = did;
				break;
			}
		}

		const always_items = row.AlwaysItem?.filter(e => e > 0) ?? [];

		creatures.set(id, {
			id,
			name,
			displayID: display_id,
			always_items
		});
	}

	log.write('Loaded %d creatures', creatures.size);
	is_initialized = true;
};

const get_all_creatures = () => {
	return creatures;
};

const get_creature_by_id = (id) => {
	return creatures.get(id);
};

export {
	initialize_creature_list,
	get_all_creatures,
	get_creature_by_id
};
