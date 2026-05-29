/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
*/

const log = require('../../log');
const db2 = require('../../casc/db2');

const file_data_to_info = new Map();

let is_initialized = false;
let init_promise = null;

// ComponentTextureFileData.GenderIndex: 0=male, 1=female, 2=none, 3=any/generic
const GENDER_ANY = 3;

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading ComponentTextureFileData...');

		for (const [id, row] of await db2.ComponentTextureFileData.getAllRows()) {
			file_data_to_info.set(id, {
				raceID: row.RaceID,
				genderIndex: row.GenderIndex,
				classID: row.ClassID
			});
		}

		log.write('Loaded ComponentTextureFileData for %d textures', file_data_to_info.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

/**
 * Filter a list of FileDataIDs to find the best match for race/gender/class.
 * Mirrors wowmodelviewer's item-texture query: exclude the opposite gender and
 * inapplicable classes, then prefer specific gender over generic and the
 * subject class over the generic (class 0).
 * @param {number[]} file_data_ids - list of candidate FileDataIDs
 * @param {number} race_id - character race ID
 * @param {number} gender_index - 0=male, 1=female
 * @param {number} [class_id] - character class ID (12=demon hunter); 0=generic
 * @returns {number|null} - best matching FileDataID or null
 */
const getTextureForRaceGender = (file_data_ids, race_id, gender_index, class_id = 0) => {
	if (!file_data_ids || file_data_ids.length === 0)
		return null;

	// single option has no ambiguity
	if (file_data_ids.length === 1)
		return file_data_ids[0];

	// fdids without a ComponentTextureFileData entry carry no constraint
	const candidates = file_data_ids.map(fdid => ({ fdid, info: file_data_to_info.get(fdid) }));
	if (!candidates.some(c => c.info))
		return file_data_ids[0];

	// exclude the opposite definite gender and inapplicable classes entirely.
	// keep matching/generic gender and matching/generic(0) class.
	const tagged = candidates.filter(c => {
		if (!c.info)
			return false;

		const gender_ok = c.info.genderIndex === gender_index || c.info.genderIndex === GENDER_ANY;
		const class_ok = c.info.classID === 0 || c.info.classID === class_id;
		return gender_ok && class_ok;
	});

	// no tagged match: fall back to an untagged entry, else skip the layer
	if (tagged.length === 0) {
		const untagged = candidates.find(c => !c.info);
		return untagged ? untagged.fdid : null;
	}

	// rank: specific gender > generic, then subject class > generic, then race match
	const rank_gender = info => info.genderIndex === gender_index ? 0 : 1;
	const rank_class = info => (class_id && info.classID === class_id) ? 0 : 1;
	const rank_race = info => info.raceID === race_id ? 0 : 1;

	tagged.sort((a, b) =>
		rank_gender(a.info) - rank_gender(b.info) ||
		rank_class(a.info) - rank_class(b.info) ||
		rank_race(a.info) - rank_race(b.info));

	return tagged[0].fdid;
};

/**
 * Check if a FileDataID has ComponentTextureFileData entry
 * @param {number} file_data_id
 * @returns {boolean}
 */
const hasEntry = (file_data_id) => {
	return file_data_to_info.has(file_data_id);
};

/**
 * Get info for a FileDataID
 * @param {number} file_data_id
 * @returns {object|null}
 */
const getInfo = (file_data_id) => {
	return file_data_to_info.get(file_data_id) || null;
};

module.exports = {
	initialize,
	getTextureForRaceGender,
	hasEntry,
	getInfo
};
