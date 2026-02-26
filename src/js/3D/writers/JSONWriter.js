/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import FileWriter from '../../file-writer.js';
import generics from '../../generics.js';



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

		await generics.createDirectory(this.out.substring(0, this.out.lastIndexOf('/')));
		const writer = new FileWriter(this.out);
		await writer.writeLine(JSON.stringify(this.data, (key, value) => {
			// Handle serialization of BigInt, as JS will not handle it as per spec (TC39)
			return typeof value === 'bigint' ? value.toString() : value
		}, '\t'));
		writer.close();
	}
}

export default JSONWriter;