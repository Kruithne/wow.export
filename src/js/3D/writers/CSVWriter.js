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
	 * Escape a CSV field value if it contains special characters.
	 * @param {*} value - The value to escape
	 * @returns {string} - The escaped value
	 */
	escapeCSVField(value) {
		if (value === null || value === undefined)
			return '';
		
		const str = value.toString();
		if (str.includes(';') || str.includes('"') || str.includes('\n'))
			return '"' + str.replace(/"/g, '""') + '"';
		
		return str;
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
		await writer.writeLine(this.fields.map(field => this.escapeCSVField(field)).join(';'));

		// Write rows.
		const nFields = this.fields.length;
		for (const row of this.rows) {
			const rowOut = new Array(nFields);
			for (let i = 0; i < nFields; i++)
				rowOut[i] = this.escapeCSVField(row[this.fields[i]]);

			await writer.writeLine(rowOut.join(';'));
		}

		writer.close();
	}
}

module.exports = CSVWriter;