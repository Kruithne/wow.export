const BufferWrapper = require('../buffer');
const BLTEReader = require('./blte-reader');

const EMPTY_HASH = '00000000000000000000000000000000';
const ENC_MAGIC = 0x4E45;

const LocaleFlag = {
	All: 0xFFFFFFFF,
	None: 0,
	enUS: 0x2,
	koKR: 0x4,
	frFR: 0x10,
	deDE: 0x20,
	zhCN: 0x40,
	esES: 0x80,
	zhTW: 0x100,
	enGB: 0x200,
	enCH: 0x400,
	enTW: 0x800,
	esMX: 0x1000,
	ruRU: 0x2000,
	ptBR: 0x4000,
	itIT: 0x8000,
	ptPT: 0x10000,
	enSG: 0x20000000,
	plPL: 0x40000000,
	All_WoW: 0x1F3F6
};

const ContentFlag = {
	None: 0,
	F00000001: 0x1,
	F00000002: 0x2,
	F00000004: 0x4,
	F00000008: 0x8,
	F00000010: 0x10,
	LowViolence: 0x80,
	F10000000: 0x10000000,
	F20000000: 0x20000000,
	Bundle: 0x40000000,
	NoCompression: 0x80000000
};

class CASC {
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
	parseIndexFile(data) {
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
	 */
	async parseRootFile(data, hash) {
		const root = new BLTEReader(data, hash);

		let typeIndex = 0;
		const rootTypes = this.rootTypes = new Map();
		const rootEntries = this.rootEntries = [];
		const rootIndex = new Map();

		while (root.remainingBytes > 0) {
			const count = root.readInt32LE();

			const contentFlag = root.readUInt32LE();
			const localeFlag = root.readUInt32LE();
			
			if (localFlag === LocaleFlag.None)
				throw new Error('No locale specified for root entry');

			if (contentFlag !== ContentFlag.None && (contentFlag & (ContentFlag.F00000008 | ContentFlag.F00000010 | ContentFlag.NoCompression | ContentFlag.F20000000) === 0))
				throw new Error('Invalid content flag: ' + contentFlag);

			rootTypes.set(typeIndex, { localeFlag, contentFlag });

			const entries = new Array(count);
			let fileDataIndex = 0;

			for (let i = 0; i < count; i++) {
				const nextID = fileDataIndex + root.readInt32LE();
				entries[i] = { rootType: typeIndex, fileDataID: nextID };
				fileDataIndex = nextID + 1;
			}

			for (let i = 0; i < count; i++) {
				const key = root.readHexString(16);
				const hash = root.readHexString(8);

				const entry = entries[i];
				const hashCheck = rootIndex.get(entry.fileDataID);
				if (hashCheck !== undefined && hashCheck !== hash)
					continue;

				rootEntries.push({ hash, fileDataID: entry.fileDataID, key, type: entry.rootType });
				rootIndex.set(entry.fileDataID, hash);
			}

			typeIndex++;
		}
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