import fsp from 'node:fs/promises';
import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import * as constants from '../lib/constants.js';
import * as generics from '../lib/generics.js';

let realm_list = null;

const parseRealmList = (data) => {
	const realms = {};

	let realmCount = 0;
	let regionCount = 0;

	for (const [regionTag, region] of Object.entries(data)) {
		regionCount++;
		realms[regionTag] = region.realms.map(realm => {
			realmCount++;
			return {
				name: realm.name,
				id: realm.id,
				slug: realm.slug
			};
		});
	}

	log.write(`Loaded ${realmCount} realms in ${regionCount} regions.`);

	realm_list = realms;
};

const get_realm_list = () => realm_list;

const load = async () => {
	log.write('Loading realmlist...');

	let url = String(core.get_config('realmListURL'));
	if (typeof url !== 'string')
		throw new Error('Missing/malformed realmListURL in configuration!');

	try {
		const realmList = JSON.parse(await fsp.readFile(constants.CACHE.REALMLIST, 'utf8'));
		parseRealmList(realmList);
	} catch (e) {
		log.write('Failed to load realmlist from disk (not cached)');
	}

	try {
		const res = await generics.get(url);

		if (res.ok) {
			const json_text = await res.text();
			const json = JSON.parse(json_text);
			parseRealmList(json);

			await fsp.writeFile(constants.CACHE.REALMLIST, json_text, 'utf8');
		} else {
			log.write(`Failed to retrieve realmlist from ${url} (${res.status})`);
		}
	} catch (e) {
		log.write(`Failed to retrieve realmlist from ${url}: ` + e.message);
	}
};

export { load, get_realm_list };
