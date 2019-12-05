const fs = require('fs');
const util = require('util');
const readline = require('readline');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');

/**
 * Load the geoset mapping from disk.
 * @param {number} fileDataID
 * @param {Array} geosets
 */
const loadMapping = async (fileDataID, geosets) => {
	const mapFile = util.format(constants.GEOSET_MAPPING, fileDataID);
	const mappingExists = await generics.fileExists(mapFile);

	if (mappingExists) {
		const fd = fs.createReadStream(mapFile, 'utf8');
		const rl = readline.createInterface({ input: fd, crlfDelay: Infinity });

		for await (const line of rl) {
			if (line.indexOf('=') > -1) {
				const parts = line.split('=');
				const index = Number(parts[0]);
				const label = parts[1].trim();

				if (!isNaN(index) && index < geosets.length && label.length > 0)
					geosets[index].label = label;
			}
		}

		log.write('Loaded geoset mapping for %d (%s)', fileDataID, mapFile);
	}
};

module.exports = { loadMapping };