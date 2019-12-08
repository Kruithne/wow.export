const listfile = require('../casc/listfile');
const core = require('../core');

class Texture {
	static FLAG_WRAP_U() {
		return 0x1;
	}

	static FLAG_WRAP_V() {
		return 0x2;
	}

	/**
	 * Construct a new Texture instance.
	 * @param {number} flags 
	 * @param {number} fileDataID
	 */
	constructor(flags, fileDataID) {
		this.flags = flags;
		this.fileDataID = fileDataID || 0;
	}

	/**
	 * Set the texture file using a file name.
	 * @param {string} fileName 
	 */
	setFileName(fileName) {
		this.fileDataID = listfile.getByFilename(fileName) || 0;
	}

	/**
	 * Obtain the texture file for this texture, instance cached.
	 * Returns NULL if fileDataID is not set.
	 */
	async getTextureFile() {
		if (this.fileDataID > 0) {
			if (!this.data)
				this.data = await core.view.casc.getFile(this.fileDataID);

			return this.data;
		}

		return null;
	}
}

module.exports = Texture;