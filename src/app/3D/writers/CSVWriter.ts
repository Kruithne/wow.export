/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import * as generics from '../../generics';
import FileWriter from '../../file-writer';

export default class CSVWriter {
	out: string;
	fields: string[];
	rows: object[];

	/**
	 * Construct a new CSVWriter instance.
	 * @param {string} out
	 */
	constructor(out: string) {
		this.out = out;
	}

	/**
	 * Add fields to this CSV.
	 * @param fields
	 */
	addField(...fields: string[]): void {
		this.fields.push(...fields);
	}

	/**
	 * Add a row to this CSV.
	 * @param row
	 */
	addRow(row: object): void {
		this.rows.push(row);
	}

	/**
	 * Write the CSV to disk.
	 * @param overwrite
	 */
	async write(overwrite: boolean = true): Promise<void> {
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