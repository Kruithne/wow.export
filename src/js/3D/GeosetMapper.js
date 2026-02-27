/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */

const GEOSET_GROUPS = {
	0: 'Hair',
	100: 'FacialA',
	200: 'FacialB',
	300: 'FacialC',
	400: 'Gloves',
	500: 'Boots',
	600: 'Tail',
	700: 'Ears',
	800: 'Wrists',
	900: 'Kneepads',
	1000: 'Chest',
	1100: 'Pants',
	1200: 'Tabard',
	1300: 'Trousers',
	1400: 'Loincloth',
	1500: 'Cloak',
	1600: 'FacialJewelry',
	1700: 'Eyeglow',
	1800: 'Belt',
	1900: 'Bone/Tail',
	2000: 'Feet',
	2100: 'Skull',
	2200: 'Torso',
	2300: 'HandAttach',
	2400: 'HeadAttach',
	2500: 'DHBlindfolds',
	2600: 'Shoulders',
	2700: 'Helm',
	2800: 'ArmUpper',
	2900: 'MechagnomeArms',
	3000: 'MechagnomeLegs',
	3100: 'MechagnomeFeet',
	3200: 'HeadSwap',
	3300: 'Eyes',
	3400: 'Eyebrows',
	3500: 'Piercings',
	3600: 'Necklace',
	3700: 'Headdress',
	3800: 'Tails',
	3900: 'MiscAccessory',
	4000: 'MiscFeature',
	4100: 'Noses',
	4200: 'HairDecoA',
	4300: 'HornDeco',
	4400: 'BodySize',
	4600: 'Dracthyr',
	5100: 'EyeGlowB'
};

/**
 * Get the label for a geoset based on the group.
 * @param {number} index 
 * @param {number} id 
 */
const getGeosetName = (index, id) => {
	if (id === 0)
		return 'Geoset' + index;

	const base = Math.floor(id / 100) * 100;
	const group = GEOSET_GROUPS[base];

	if (group)
		return group + (id - base);

	return 'Geoset' + index + "_" + base;
};

/**
 * Map geoset names for subMeshes.
 * @param {Array} geosets
 */
const map = async (geosets) => {
	for (let i = 0, n = geosets.length; i < n; i++) {
		const geoset = geosets[i];
		geoset.label = getGeosetName(i, geoset.id);
	}
};

export { map, getGeosetName };

export default { map, getGeosetName };