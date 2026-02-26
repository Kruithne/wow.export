/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const ITEM_SLOTS = {
	0: 'Non-equippable',
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
	11: 'Finger',
	12: 'Trinket',
	13: 'One-hand',
	14: 'Off-hand',
	15: 'Ranged',
	16: 'Back',
	17: 'Two-hand',
	18: 'Bag',
	19: 'Tabard',
	20: 'Chest',
	21: 'Main-hand',
	22: 'Off-hand',
	23: 'Off-hand',
	24: 'Ammo',
	25: 'Thrown',
	26: 'Ranged',
	27: 'Quiver',
	28: 'Relic'
};

export const getSlotName = (id) => {
	return ITEM_SLOTS[id] ?? 'Unknown';
};
