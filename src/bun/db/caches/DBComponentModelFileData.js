import * as log from '../../lib/log.js';
import db2 from '../../casc/db2.js';

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

const getModelForRaceGender = (file_data_ids, race_id, gender_index, fallback_race_id = 0) => {
	if (!file_data_ids || file_data_ids.length === 0)
		return null;

	if (file_data_ids.length === 1)
		return file_data_ids[0];

	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === race_id && info.genderIndex === gender_index)
			return fdid;
	}

	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === race_id && info.genderIndex === GENDER_ANY)
			return fdid;
	}

	if (fallback_race_id > 0) {
		for (const fdid of file_data_ids) {
			const info = file_data_to_info.get(fdid);
			if (info && info.raceID === fallback_race_id && (info.genderIndex === gender_index || info.genderIndex === GENDER_ANY))
				return fdid;
		}
	}

	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (info && info.raceID === 0)
			return fdid;
	}

	return file_data_ids[0];
};

const getModelsForRaceGenderByPosition = (file_data_ids, race_id, gender_index) => {
	const result = { left: null, right: null };

	if (!file_data_ids || file_data_ids.length === 0)
		return result;

	const by_position = { 0: [], 1: [] };

	for (const fdid of file_data_ids) {
		const info = file_data_to_info.get(fdid);
		if (!info || (info.positionIndex !== 0 && info.positionIndex !== 1))
			continue;

		by_position[info.positionIndex].push({ fdid, info });
	}

	const find_best = (candidates) => {
		for (const c of candidates) {
			if (c.info.raceID === race_id && c.info.genderIndex === gender_index)
				return c.fdid;
		}

		for (const c of candidates) {
			if (c.info.raceID === race_id && c.info.genderIndex === GENDER_ANY)
				return c.fdid;
		}

		for (const c of candidates) {
			if (c.info.raceID === 0)
				return c.fdid;
		}

		return candidates.length > 0 ? candidates[0].fdid : null;
	};

	result.left = find_best(by_position[0]);
	result.right = find_best(by_position[1]);

	return result;
};

const hasEntry = (file_data_id) => {
	return file_data_to_info.has(file_data_id);
};

const getInfo = (file_data_id) => {
	return file_data_to_info.get(file_data_id) || null;
};

export {
	initialize,
	getModelForRaceGender,
	getModelsForRaceGenderByPosition,
	hasEntry,
	getInfo
};
