const BufferWrapper = require('../buffer');
const BLTEReader = require('./blte-reader');

const EMPTY_HASH = '00000000000000000000000000000000';
const ENC_MAGIC = 0x4E45;

const ROOT_MAGIC = 0x4D465354;

const LocaleFlag = {
	enUS: 0x2,
	koKR: 0x4,
	frFR: 0x10,
	deDE: 0x20,
	zhCN: 0x40,
	esES: 0x80,
	zhTW: 0x100,
	enGB: 0x200,
	enCN: 0x400,
	enTW: 0x800,
	esMX: 0x1000,
	ruRU: 0x2000,
	ptBR: 0x4000,
	itIT: 0x8000,
	ptPT: 0x10000
};

const ContentFlag = {
	LoadOnWindows: 0x8,
	LoadOnMacOS: 0x10,
	LowViolence: 0x80,
	DoNotLoad: 0x100,
	UpdatePlugin: 0x800,
	Encrypted: 0x8000000,
	NoNameHash: 0x10000000,
	UncommonResolution: 0x20000000,
	Bundle: 0x40000000,
	NoCompression: 0x80000000
};

class CASC {
	static Locale = LocaleFlag;
	static Content = ContentFlag;

	constructor() {
		this.archives = new Map();
		this.encodingSizes = new Map();
		this.encodingKeys = new Map();
	}

	/**
	 * Parse entries from an archive index.
	 * @param {BufferWrapper} data 
	 * @returns {object[]}
	 */
	parseArchiveIndex(data) {
		// Skip to the end of the archive to find the count.
		data.seek(-12);
		const count = data.readInt32LE();

		if (count * 24 > data.byteLength)
			throw new Error('Unable to parse archive, unexpected size: ' + data.byteLength);

		data.seek(0); // Reset position.
		const entries = new Array(count);

		for (let i = 0; i < count; i++) {
			let hash = data.readHexString(16);

			// Skip zero hashes.
			if (hash === EMPTY_HASH)
				hash = data.readHexString(16);

			entries[i] = {
				hash,
				size: data.readInt32BE(),
				offset: data.readInt32BE()
			};
		}

		return entries;
	}

	/**
	 * Parse entries from a root file.
	 * @param {BufferWrapper} data 
	 * @param {string} hash 
	 * @returns {number}
	 */
	async parseRootFile(data, hash) {
		const root = new BLTEReader(data, hash);

		const magic = root.readUInt32LE();
		if (magic !== ROOT_MAGIC)
			throw new Error('Invalid root magic: ' + magic);
		
		const totalFileCount = root.readUInt32LE();
		const namedFileCount = root.readUInt32LE();
		const allowNamelessFiles = totalFileCount !== namedFileCount;

		const rootTypes = this.rootTypes = [];
		const rootEntries = this.rootEntries = new Map();
	
		while (root.remainingBytes > 0) {
			const numRecords = root.readUInt32LE();
			
			const contentFlags = root.readUInt32LE();
			const localeFlags = root.readUInt32LE();

			const entries = new Array(numRecords);
			let fileDataID = 0;
			for (let i = 0; i < numRecords; i++)  {
				const nextID = fileDataID + root.readInt32LE();
				entries[i] = { fileDataID: nextID, contentKey: null, hash: 0 };
				fileDataID = nextID + 1;
			}

			// Parse MD5 content keys for entries.
			for (let i = 0; i < numRecords; i++)
				entries[i].contentKey = root.readHexString(16);

			// Parse lookup hashes for entries.
			if (!(allowNamelessFiles && contentFlags & ContentFlag.NoNameHash))
				for (let i = 0; i < numRecords; i++)
					entries[i].hash = root.readUInt64LE();

			rootEntries.set(rootTypes.length, entries);

			// Push the rootType after the parsing the block so that
			// rootTypes.length can be used for the type index above.
			rootTypes.push({ contentFlags, localeFlags });
		}

		return totalFileCount;
	}
	
	/**
	 * Parse entries from an encoding file.
	 * @param {BufferWrapper} data 
	 * @param {string} hash 
	 * @returns {object}
	 */
	async parseEncodingFile(data, hash) {
		const encodingSizes = this.encodingSizes;
		const encodingKeys = this.encodingKeys;

		const encoding = new BLTEReader(data, hash);

		const magic = encoding.readUInt16LE();
		if (magic !== ENC_MAGIC)
			throw new Error('Invalid encoding magic: ' + magic);

		encoding.move(1); // version
		const hashSizeCKey = encoding.readUInt8();
		const hashSizeEKey = encoding.readUInt8();
		const cKeyPageSize = encoding.readInt16BE() * 1024;
		encoding.move(2); // eKeyPageSize
		const cKeyPageCount = encoding.readInt32BE();
		encoding.move(4 + 1); // eKeyPageCount + unk11
		const specBlockSize = encoding.readInt32BE();

		encoding.move(specBlockSize + (cKeyPageCount * (hashSizeCKey + 16)));

		const pagesStart = encoding.offset;
		for (let i = 0; i < cKeyPageCount; i++) {
			const pageStart = pagesStart + (cKeyPageSize * i);
			encoding.seek(pageStart);

			while (encoding.offset < (pageStart + pagesStart)) {
				const keysCount = encoding.readUInt8();
				if (keysCount === 0)
					break;

				const size = encoding.readInt40BE();
				const cKey = encoding.readHexString(hashSizeCKey);

				encodingSizes.set(cKey, size);
				encodingKeys.set(cKey, encoding.readHexString(hashSizeEKey));

				encoding.move(hashSizeEKey * (keysCount - 1));
			}
		}
	}
}

module.exports = CASC;