import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

// NPC slot index -> equipment slot ID
const NPC_SLOT_MAP = {
	0: 1,   // head
	1: 3,   // shoulder
	2: 4,   // shirt
	3: 5,   // chest
	4: 6,   // waist
	5: 7,   // legs
	6: 8,   // feet
	7: 9,   // wrist
	8: 10,  // hands
	9: 19,  // tabard
	10: 15  // back
};

// CreatureDisplayInfoExtraID -> Map<slot_id, item_display_info_id>
const equipment_map = new Map();

let is_initialized = false;
let init_promise = null;

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading NPC equipment data...');

		for (const row of (await db2.NPCModelItemSlotDisplayInfo.getAllRows()).values()) {
			const extra_id = row.NpcModelID;
			const npc_slot = row.ItemSlot;
			const display_id = row.ItemDisplayInfoID;

			const slot_id = NPC_SLOT_MAP[npc_slot];
			if (slot_id === undefined || display_id === 0)
				continue;

			if (!equipment_map.has(extra_id))
				equipment_map.set(extra_id, new Map());

			equipment_map.get(extra_id).set(slot_id, display_id);
		}

		log.write('Loaded NPC equipment for %d creature display extras', equipment_map.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize();
};

const get_equipment = (extra_display_id) => {
	return equipment_map.get(extra_display_id) ?? null;
};

export {
	initialize,
	ensure_initialized as ensureInitialized,
	get_equipment
};
