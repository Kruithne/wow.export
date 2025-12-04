/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// equipment slots with numeric IDs and display names
const EQUIPMENT_SLOTS = [
	{ id: 1, name: 'Head' },
	{ id: 2, name: 'Neck' },
	{ id: 3, name: 'Shoulder' },
	{ id: 15, name: 'Back' },
	{ id: 5, name: 'Chest' },
	{ id: 4, name: 'Shirt' },
	{ id: 19, name: 'Tabard' },
	{ id: 9, name: 'Wrist' },
	{ id: 10, name: 'Hands' },
	{ id: 6, name: 'Waist' },
	{ id: 7, name: 'Legs' },
	{ id: 8, name: 'Feet' },
	{ id: 16, name: 'Main-hand' },
	{ id: 17, name: 'Off-hand' }
];

// maps slot ID to display name
const SLOT_ID_TO_NAME = {};
for (const slot of EQUIPMENT_SLOTS)
	SLOT_ID_TO_NAME[slot.id] = slot.name;

// maps inventory type id to slot id
const INVENTORY_TYPE_TO_SLOT_ID = {
	1: 1,   // head
	2: 2,   // neck
	3: 3,   // shoulder
	4: 4,   // shirt
	5: 5,   // chest
	6: 6,   // waist
	7: 7,   // legs
	8: 8,   // feet
	9: 9,   // wrist
	10: 10, // hands
	13: 16, // one-hand -> main-hand
	14: 17, // shield -> off-hand
	15: 16, // ranged -> main-hand
	16: 15, // back
	17: 16, // two-hand -> main-hand
	19: 19, // tabard
	20: 5,  // robe -> chest
	21: 16, // main-hand
	22: 17, // off-hand weapon
	23: 17, // holdable -> off-hand
	26: 16  // ranged right -> main-hand
};

// maps WoWModelViewer CharSlots to our slot IDs
const WMV_SLOT_TO_SLOT_ID = {
	0: 1,   // CS_HEAD -> head
	1: 3,   // CS_SHOULDER -> shoulder
	2: 8,   // CS_BOOTS -> feet
	3: 6,   // CS_BELT -> waist
	4: 4,   // CS_SHIRT -> shirt
	5: 7,   // CS_PANTS -> legs
	6: 5,   // CS_CHEST -> chest
	7: 9,   // CS_BRACERS -> wrist
	8: 10,  // CS_GLOVES -> hands
	9: 16,  // CS_HAND_RIGHT -> main-hand
	10: 17, // CS_HAND_LEFT -> off-hand
	11: 15, // CS_CAPE -> back
	12: 19  // CS_TABARD -> tabard
};

const get_slot_id_for_inventory_type = (inventory_type) => {
	return INVENTORY_TYPE_TO_SLOT_ID[inventory_type] ?? null;
};

const get_slot_id_for_wmv_slot = (wmv_slot) => {
	return WMV_SLOT_TO_SLOT_ID[wmv_slot] ?? null;
};

const get_slot_name = (slot_id) => {
	return SLOT_ID_TO_NAME[slot_id] ?? null;
};

module.exports = {
	EQUIPMENT_SLOTS,
	SLOT_ID_TO_NAME,
	INVENTORY_TYPE_TO_SLOT_ID,
	WMV_SLOT_TO_SLOT_ID,
	get_slot_id_for_inventory_type,
	get_slot_id_for_wmv_slot,
	get_slot_name
};
