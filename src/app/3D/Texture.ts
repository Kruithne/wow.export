/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import BufferWrapper from '../buffer';
import * as listfile from '../casc/listfile';
import State from '../state';

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
		this.fileDataID = listfile.getByFilename(fileName) || 0;
	}

	/**
	 * Obtain the texture file for this texture, instance cached.
	 * Returns NULL if fileDataID is not set.
	 */
	async getTextureFile(): Promise<BufferWrapper|null> {
		if (this.fileDataID > 0) {
			if (!this.data)
				this.data = await State.casc.getFile(this.fileDataID);

			return this.data;
		}

		return null;
	}
}