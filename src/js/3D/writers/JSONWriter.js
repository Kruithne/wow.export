/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const generics = require('../../generics');
const path = require('path');
const FileWriter = require('../../file-writer');

class JSONWriter {
	/**
	 * Construct a new JSONWriter instance.
	 * @param {string} out 
	 */
	constructor(out) {
		this.out = out;
		this.data = {};
	}

	/**
	 * Add a property to this JSON.
	 * @param {string} name 
	 * @param {object} data 
	 */
	addProperty(name, data) {
		this.data[name] = data;
	}

	/**
	 * Write the JSON to disk.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);
		writer.writeLine(JSON.stringify(this.data, null, '\t'));
		await writer.close();
	}
}

module.exports = JSONWriter;