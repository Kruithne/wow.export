/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const core = require('../core');
const log = require('../log');
const constants = require('../constants');
const fsp = require('fs').promises;
const generics = require('../generics');

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

	core.view.realmList = realms;
};

const load = async () => {
	log.write('Loading realmlist...');

	let url = String(core.view.config.realmListURL);
	if (typeof url !== 'string')
		throw new Error('Missing/malformed realmListURL in configuration!');

	try {
		const realmList = JSON.parse(await fsp.readFile(constants.CACHE.REALMLIST, 'utf8'));
		parseRealmList(realmList);
	} catch (e) {
		log.write('Failed to load realmlist from disk (not cached)')
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

module.exports = {
	load
};