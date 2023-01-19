/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const generics = require('../../generics');
const FileWriter = require('../../file-writer');
const core = require('../../core');

class MTLWriter {
	/**
	 * Construct a new MTLWriter instance.
	 * @param {string} out
	 */
	constructor(out) {
		this.out = out;
		this.materials = [];
	}

	/**
	 * Add a material to this material library.
	 * @param {string} name
	 * @param {string} file
	 */
	addMaterial(name, file) {
		this.materials.push({ name, file });
	}

	/**
	 * Returns true if this material library is empty.
	 */
	get isEmpty() {
		return this.materials.length === 0;
	}

	/**
	 * Write the material library to disk.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		// Don't bother writing an empty material library.
		if (this.isEmpty)
			return;

		// If overwriting is disabled, check file existence.
		if (!overwrite && await generics.fileExists(this.out))
			return;

		const mtlDir = path.dirname(this.out);
		await generics.createDirectory(mtlDir);

		const useAbsolute = core.view.config.enableAbsoluteMTLPaths;
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

module.exports = MTLWriter;