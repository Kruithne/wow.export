/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import { fileExists, createDirectory } from '../../generics';
import State from '../../state';
import FileWriter from '../../file-writer';

type MTLMaterial = {
	name: string;
	file: string;
}

export default class MTLWriter {
	out: string;
	materials: Array<MTLMaterial> = [];

	/**
	 * Construct a new MTLWriter instance.
	 * @param out
	 */
	constructor(out: string) {
		this.out = out;
	}

	/**
	 * Add a material to this material library.
	 * @param name
	 * @param file
	 */
	addMaterial(name: string, file: string): void {
		this.materials.push({ name: name, file: file });
	}

	/**
	 * Returns true if this material library is empty.
	 */
	get isEmpty(): boolean {
		return this.materials.length === 0;
	}

	/**
	 * Write the material library to disk.
	 * @param overwrite
	 */
	async write(overwrite = true): Promise<void> {
		// Don't bother writing an empty material library.
		if (this.isEmpty)
			return;

		// If overwriting is disabled, check file existence.
		if (!overwrite && await fileExists(this.out))
			return;

		const mtlDir = path.dirname(this.out);
		await createDirectory(mtlDir);

		const useAbsolute = State.config.enableAbsoluteMTLPaths;
		const writer = new FileWriter(this.out);

		for (const material of this.materials) {
			writer.writeLine('newmtl ' + material.name);
			writer.writeLine('illum 1');

			let materialFile = material.file;
			if (useAbsolute)
				materialFile = path.resolve(mtlDir, materialFile);

			writer.writeLine('map_Kd ' + materialFile);
		}

		await writer.close();
	}
}