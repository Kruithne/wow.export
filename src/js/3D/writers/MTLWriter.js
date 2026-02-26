/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import core from '../../core.js';
import FileWriter from '../../file-writer.js';
import generics from '../../generics.js';



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

		const mtlDir = this.out.substring(0, this.out.lastIndexOf('/'));
		await generics.createDirectory(mtlDir);

		const useAbsolute = core.view.config.enableAbsoluteMTLPaths;
		const writer = new FileWriter(this.out);

		for (const material of this.materials) {
			await writer.writeLine('newmtl ' + material.name);
			await writer.writeLine('illum 1');

			let materialFile = material.file;
			if (useAbsolute)
				materialFile = mtlDir + '/' + materialFile;

			await writer.writeLine('map_Kd ' + materialFile);
		}

		writer.close();
	}
}

export default MTLWriter;