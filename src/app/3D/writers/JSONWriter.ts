/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import { fileExists, createDirectory } from '../../generics';
import FileWriter from '../../file-writer';

type JSONPropertyType = string | number | boolean | null | JSONPropertyType[] | { [key: string]: JSONPropertyType };

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
	addProperty(name: string, data: JSONPropertyType) {
		this.data[name] = data;
	}

	/**
	 * Write the JSON to disk.
	 * @param overwrite
	 */
	async write(overwrite = true) {
		// If overwriting is disabled, check file existence.
		if (!overwrite && await fileExists(this.out))
			return;

		await createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);
		writer.writeLine(JSON.stringify(this.data, (key, value) => {
			// Handle serialization of BigInt, as JS will not handle it as per spec (TC39)
			return typeof value === 'bigint' ? value.toString() : value;
		}, '\t'));
		await writer.close();
	}
}