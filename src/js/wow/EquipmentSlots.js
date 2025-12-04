/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// equipment slots displayed on the character tab
const EQUIPMENT_SLOTS = [
	'Head',
	'Neck',
	'Shoulder',
	'Back',
	'Chest',
	'Shirt',
	'Tabard',
	'Wrist',
	'Hands',
	'Waist',
	'Legs',
	'Feet',
	'Main-hand',
	'Off-hand'
];

// maps inventory type id to equipment slot name
const INVENTORY_TYPE_TO_SLOT = {
	1: 'Head',
	2: 'Neck',
	3: 'Shoulder',
	4: 'Shirt',
	5: 'Chest',
	6: 'Waist',
	7: 'Legs',
	8: 'Feet',
	9: 'Wrist',
	10: 'Hands',
	13: 'Main-hand',
	14: 'Off-hand',
	15: 'Main-hand',
	16: 'Back',
	17: 'Main-hand',
	19: 'Tabard',
	20: 'Chest',
	21: 'Main-hand',
	22: 'Off-hand',
	23: 'Off-hand',
	26: 'Main-hand'
};

const get_slot_for_inventory_type = (inventory_type) => {
	return INVENTORY_TYPE_TO_SLOT[inventory_type] ?? null;
};

module.exports = {
	EQUIPMENT_SLOTS,
	INVENTORY_TYPE_TO_SLOT,
	get_slot_for_inventory_type
};
