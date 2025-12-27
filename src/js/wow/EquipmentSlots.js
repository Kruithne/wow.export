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

// M2 attachment IDs (from wowmodelviewer POSITION_SLOTS enum)
const ATTACHMENT_ID = {
	SHIELD: 0,
	HAND_RIGHT: 1,
	HAND_LEFT: 2,
	ELBOW_RIGHT: 3,
	ELBOW_LEFT: 4,
	SHOULDER_RIGHT: 5,
	SHOULDER_LEFT: 6,
	KNEE_RIGHT: 7,
	KNEE_LEFT: 8,
	HIP_RIGHT: 9,
	HIP_LEFT: 10,
	HELMET: 11,
	BACK: 12,
	SHOULDER_FLAP_RIGHT: 13,
	SHOULDER_FLAP_LEFT: 14,
	BUST: 15,
	BUST2: 16,
	FACE: 17,
	ABOVE_CHARACTER: 18,
	GROUND: 19,
	TOP_OF_HEAD: 20,
	LEFT_PALM2: 21,
	RIGHT_PALM2: 22,
	PRE_CAST_2L: 23,
	PRE_CAST_2R: 24,
	PRE_CAST_3: 25,
	SHEATH_MAIN_HAND: 26,
	SHEATH_OFF_HAND: 27,
	SHEATH_SHIELD: 28,
	BELLY: 29,
	LEFT_BACK: 30,
	RIGHT_BACK: 31,
	LEFT_HIP_SHEATH: 32,
	RIGHT_HIP_SHEATH: 33,
	BUST3: 34,
	PALM3: 35,
	RIGHT_PALM_UNK2: 36,
	LEFT_FOOT: 47,
	RIGHT_FOOT: 48,
	SHIELD_NO_GLOVE: 49,
	SPINE_LOW: 50,
	ALTERED_SHOULDER_R: 51,
	ALTERED_SHOULDER_L: 52,
	BELT_BUCKLE: 53,
	SHEATH_CROSSBOW: 54,
	HEAD_TOP: 55
};

// texture layer priority per slot
// lower values render first, higher values render on top
const SLOT_LAYER = {
	4: 10,   // shirt
	7: 10,   // legs/pants
	1: 11,   // head
	8: 11,   // feet/boots
	3: 13,   // shoulder
	5: 13,   // chest
	19: 17,  // tabard
	6: 18,   // waist/belt
	9: 19,   // wrist/bracers
	10: 20,  // hands/gloves
	16: 21,  // main-hand
	17: 22,  // off-hand
	15: 23   // back/cape
};

// maps equipment slot ID to M2 attachment ID(s)
// some slots have multiple attachments (e.g., shoulders have left and right)
// order matches ItemDisplayInfo.ModelResourcesID order
const SLOT_TO_ATTACHMENT = {
	1: [ATTACHMENT_ID.HELMET],                                      // head
	3: [ATTACHMENT_ID.SHOULDER_LEFT, ATTACHMENT_ID.SHOULDER_RIGHT], // shoulder (left first, then right)
	15: [ATTACHMENT_ID.BACK],                                       // back/cape
	16: [ATTACHMENT_ID.HAND_RIGHT],                                 // main-hand weapon
	17: [ATTACHMENT_ID.HAND_LEFT, ATTACHMENT_ID.SHIELD]             // off-hand (weapon or shield)
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

const get_attachment_ids_for_slot = (slot_id) => {
	return SLOT_TO_ATTACHMENT[slot_id] ?? null;
};

const get_slot_layer = (slot_id) => {
	return SLOT_LAYER[slot_id] ?? 10;
};

module.exports = {
	EQUIPMENT_SLOTS,
	SLOT_ID_TO_NAME,
	INVENTORY_TYPE_TO_SLOT_ID,
	WMV_SLOT_TO_SLOT_ID,
	ATTACHMENT_ID,
	SLOT_TO_ATTACHMENT,
	SLOT_LAYER,
	get_slot_id_for_inventory_type,
	get_slot_id_for_wmv_slot,
	get_slot_name,
	get_attachment_ids_for_slot,
	get_slot_layer
};
