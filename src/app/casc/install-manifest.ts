const INSTALL_SIG = 0x4E49; // IN
import BLTEReader from './blte-reader';

type InstallTag = { name: string, type: number, mask: number[] };
type InstallFile = { name: string, hash: string, size: number, tags: string[]};

export default class InstallManifest {
	version: number = 0;
	hashSize: number = 0;
	numTags: number = 0;
	numFiles: number = 0;
	maskSize: number = 0;

	tags: Array<InstallTag> = [];
	files: Array<InstallFile> = [];

	/**
	 * Construct a new InstallManifest instance.
	 * @param data
	 */
	constructor(data: BLTEReader) {
		this.parse(data);
	}

	/**
	 * Parse data for this install manifest.
	 * @param data
	 */
	parse(data: BLTEReader): void {
		if (data.readUInt16LE() !== INSTALL_SIG)
			throw new Error('Invalid file signature for install manifest');

		this.version = data.readUInt8() as number;
		this.hashSize = data.readUInt8() as number;
		this.numTags = data.readUInt16BE() as number;
		this.numFiles = data.readUInt32BE() as number;

		this.tags = Array(this.numTags);
		this.files = Array(this.numFiles);

		this.maskSize = Math.ceil(this.numFiles / 8);

		for (let i = 0; i < this.numTags; i++) {
			this.tags[i] = {
				name: data.readNullTerminatedString(),
				type: data.readUInt16BE() as number,
				mask: data.readUInt8(this.maskSize) as number[]
			};
		}

		for (let i = 0; i < this.numFiles; i++) {
			this.files[i] = {
				name: data.readNullTerminatedString(),
				hash: data.readHexString(this.hashSize),
				size: data.readUInt32BE() as number,
				tags: []
			};
		}

		// Pre-compute tags.
		for (const tag of this.tags) {
			const mask = tag.mask;
			for (let i = 0, n = mask.length; i < n; i++) {
				for (let j = 0; j < 8; j++) {
					if ((mask[i] >>> (7 - j) & 0x1) === 1)
						this.files[(i % n * 8) + j]?.tags.push(tag.name);
				}
			}
		}
	}
}