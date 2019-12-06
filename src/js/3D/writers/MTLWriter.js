const generics = require('../../generics');
const FileWriter = require('../../file-writer');

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
	 * Write the material library to disk.
	 */
	async write() {
		// Don't bother writing an empty material library.
		if (this.materials.length === 0)
			return;

		await generics.createDirectory(path.dirname(this.out));
		const writer = new FileWriter(this.out);

		for (const material of this.materials) {
			writer.writeLine('newmtl ' + material.name);
			writer.writeLine('illum 1');
			writer.writeLine('map_Kd ' + material.file);
		}

		await writer.close();
	}
}

module.exports = MTLWriter;