const INSTALL_SIG = 0x4E49; // IN

class InstallManifest {
	/**
	 * Construct a new InstallManifest instance.
	 * @param {BLTEReader} data 
	 */
	constructor(data) {
		this.version = 0;
		this.hashSize = 0;
		this.numTags = 0;
		this.numFiles = 0;
		this.maskSize = 0;

		this.tags = [];
		this.files = [];

		this.parse(data);
	}

	/**
	 * Parse data for this install manifest.
	 * @param {BLTEReader} data 
	 */
	parse(data) {
		if (data.readUInt16LE() !== INSTALL_SIG)
			throw new Error('Invalid file signature for install manifest');

		this.version = data.readUInt8();
		this.hashSize = data.readUInt8();
		this.numTags = data.readUInt16BE();
		this.numFiles = data.readUInt32BE();

		this.tags = Array(this.numTags);
		this.files = Array(this.numFiles);

		this.maskSize = Math.ceil(this.numFiles / 8);

		for (let i = 0; i < this.numTags; i++) {
			this.tags[i] = {
				name: data.readNullTerminatedString(),
				type: data.readUInt16BE(),
				mask: data.readUInt8(this.maskSize)
			};
		}

		for (let i = 0; i < this.numFiles; i++) {
			this.files[i] = {
				name: data.readNullTerminatedString(),
				hash: data.readHexString(this.hashSize),
				size: data.readUInt32BE()
			};
		}
	}
}

module.exports = InstallManifest;