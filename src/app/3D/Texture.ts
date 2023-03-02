/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import BufferWrapper from '../buffer';
import Listfile from '../casc/listfile';
import { state } from '../core';

export default class Texture {
	flags: number;
	fileDataID: number;
	data: BufferWrapper;

	/**
	 * Construct a new Texture instance.
	 * @param flags
	 * @param fileDataID
	 */
	constructor(flags: number, fileDataID?: number) {
		this.flags = flags;
		this.fileDataID = fileDataID || 0;
	}

	/**
	 * Set the texture file using a file name.
	 * @param fileName
	 */
	setFileName(fileName: string): void {
		this.fileDataID = Listfile.getByFilename(fileName) || 0;
	}

	/**
	 * Obtain the texture file for this texture, instance cached.
	 * @throws {Error} If the texture fileDataID is not set.
	 * @returns The texture file.
	 */
	async getTextureFile(): Promise<BufferWrapper> {
		if (this.fileDataID > 0) {
			if (!this.data)
				this.data = await state.casc.getFile(this.fileDataID);

			return this.data;
		}

		throw new Error('Texture fileDataID is not set.');
	}
}