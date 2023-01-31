/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import fs from 'node:fs/promises';

export default class FileWriter {
	file: string;
	encoding: string;
	queue: Array<string>;

	/**
	 * Construct a new FileWriter instance.
	 * @param file
	 * @param encoding
	 */
	constructor(file: string, encoding = 'utf8') {
		this.file = file;
		this.encoding = encoding;
		this.queue = [];
	}

	/**
	 * Write a line to the file.
	 * @param line
	 */
	writeLine(line: string): void {
		this.queue.push(line);
	}

	/**
	 * Close the stream.
	 */
	async close(): Promise<void> {
		await fs.writeFile(this.file, this.queue.join('\n'), this.encoding as BufferEncoding);
	}
}