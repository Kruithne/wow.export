/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const log = require('../../log');
const db2 = require('../../casc/db2');

// maps FileDataID -> { raceID, genderIndex, classID, positionIndex }
const file_data_to_info = new Map();

let is_initialized = false;
let init_promise = null;

const GENDER_ANY = 2;

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading ComponentModelFileData...');

		for (const [id, row] of await db2.ComponentModelFileData.getAllRows()) {
			file_data_to_info.set(id, {
				raceID: row.RaceID,
				genderIndex: row.GenderIndex,
				classID: row.ClassID,
				positionIndex: row.PositionIndex
			});
		}

		log.write('Loaded ComponentModelFileData for %d models', file_data_to_info.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

/**
 * Filter a list of FileDataIDs to find the best match for race/gender
 * @param {number[]} file_data_ids - list of candidate FileDataIDs
 * @param {number} race_id - character race ID
 * @param {number} gender_index - 0=male, 1=female
 * @param {number} [fallback_race_id] - optional fallback race
 * @returns {number|null} - best matching FileDataID or null
 */
const getModelForRaceGender = (file_data_ids, race_id, gender_index, fallback_race_id = 0) => {
	if (!file_data_ids || file_data_ids.length === 0)
		return null;

	// if only one option, return it
	if (file_data_ids.length === 1)
		return file_data_ids[0];

	// try exact race + gender match
	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === race_id && info.genderIndex === gender_index)
			return fdid;
	}

	// try race + any gender
	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === race_id && info.genderIndex === GENDER_ANY)
			return fdid;
	}

	// try fallback race if provided
	if (fallback_race_id > 0) {
		for (const fdid of file_data_ids) {
			const info = file_data_to_info.get(fdid);
			if (info && info.raceID === fallback_race_id && (info.genderIndex === gender_index || info.genderIndex === GENDER_ANY))
				return fdid;
		}
	}

	// try race=0 (any race)
	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === 0)
			return fdid;
	}

	// fallback to first
	return file_data_ids[0];
};

/**
 * Check if a FileDataID has ComponentModelFileData entry
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
	getModelForRaceGender,
	hasEntry,
	getInfo
};
