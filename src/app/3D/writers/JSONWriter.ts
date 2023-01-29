/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import * as generics from '../../generics';
import FileWriter from '../../file-writer';

export default class JSONWriter {
	out: string;
	data: object;

	/**
	 * Construct a new JSONWriter instance.
	 * @param out
	 */
	constructor(out: string) {
		this.out = out;
		this.data = {};
	}

	/**
	 * Add a property to this JSON.
	 * @param name
	 * @param data
	 */
	addProperty(name: string, data: any) { // NIT: This is an actual good usecase for any, right?
		this.data[name] = data;
	}

	/**
	 * Write the JSON to disk.
	 * @param overwrite
	 */
	async write(overwrite: boolean = true) {
		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);
		writer.writeLine(JSON.stringify(this.data, (key, value) => {
			// Handle serialization of BigInt, as JS will not handle it as per spec (TC39)
			return typeof value === 'bigint' ? value.toString() : value;
		}, '\t'));
		await writer.close();
	}
}