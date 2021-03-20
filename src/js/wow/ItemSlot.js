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
	13: 'One-Hand',
	14: 'Off Hand',
	15: 'Ranged',
	16: 'Back',
	17: 'Two-Hand',
	18: 'Bag',
	19: 'Tabard',
	20: 'Chest',
	21: 'Main Hand',
	22: 'Off Hand',
	23: 'Held in Off-hand',
	24: 'Ammo',
	25: 'Thrown',
	26: 'Ranged',
	27: 'Quiver',
	28: 'Relic'
};

/**
 * Get the label for an item slot based on the ID.
 * @param {number} id 
 */
const getSlotName = (id) => {
	return ITEM_SLOTS[id] ?? 'Unknown';
};

module.exports = { getSlotName };
