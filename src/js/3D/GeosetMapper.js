const GEOSET_GROUPS = {
	0: 'Hair',
	100: 'FacialA',
	200: 'FacialB',
	300: 'FacialC',
	400: 'Gloves',
	500: 'Boots',
	700: 'Ears',
	800: 'Wrists',
	900: 'Kneepads',
	1000: 'Chest',
	1100: 'Pants',
	1200: 'Tabard',
	1300: 'Trousers',
	1500: 'Cloak',
	1700: 'Eyeglow',
	1800: 'Belt',
	1900: 'Tail',
	2000: 'Feet',
	2300: 'DH Hands',
	2400: 'DH Horns',
	2500: 'DH Blindfolds'
};

/**
 * Get the label for a geoset based on the group.
 * @param {number} index 
 * @param {number} id 
 */
const getGeosetName = (index, id) => {
	if (id === 0)
		return 'Geoset ' + index;

	const base = Math.floor(id / 100) * 100;
	const group = GEOSET_GROUPS[base];

	if (group)
		return group + ' ' + (id - base);

	return 'Geoset ' + index;
};

/**
 * Map geoset names for submeshes.
 * @param {Array} geosets
 */
const map = async (geosets) => {
	for (let i = 0, n = geosets.length; i < n; i++) {
		const geoset = geosets[i];
		geoset.label = getGeosetName(i, geoset.id);
	}
};

module.exports = { map, getGeosetName };