/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const generics = require('../../generics');
const path = require('path');
const FileWriter = require('../../file-writer');

class CSVWriter {
	/**
	 * Construct a new CSVWriter instance.
	 * @param {string} out 
	 */
	constructor(out) {
		this.out = out;
		this.fields = [];
		this.rows = [];
	}

	/**
	 * Add fields to this CSV.
	 * @param  {...string} fields 
	 */
	addField(...fields) {
		this.fields.push(...fields);
	}

	/**
	 * Add a row to this CSV.
	 * @param {object} row
	 */
	addRow(row) {
		this.rows.push(row);
	}

	/**
	 * Write the CSV to disk.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		// Don't bother writing an empty CSV file.
		if (this.rows.length === 0)
			return;

		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		// Write header.
		writer.writeLine(this.fields.join(';'));

		// Write rows.
		const nFields = this.fields.length;
		for (const row of this.rows) {
			const rowOut = new Array(nFields);
			for (let i = 0; i < nFields; i++)
				rowOut[i] = row[this.fields[i]];

			writer.writeLine(rowOut.join(';'));
		}

		await writer.close();
	}
}

module.exports = CSVWriter;