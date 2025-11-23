/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const BLTEReader = require('./blte-reader').BLTEReader;
const listfile = require('./listfile');
const dbd_manifest = require('./dbd-manifest');
const log = require('../log');
const core = require('../core');
const path = require('path');
const constants = require('../constants');
const LocaleFlag = require('./locale-flags').flags;
const ContentFlag = require('./content-flags');
const InstallManifest = require('./install-manifest');
const BufferWrapper = require('../buffer');
const mmap = require('../mmap');

const ENC_MAGIC = 0x4E45;
const ROOT_MAGIC = 0x4D465354;

class CASC {
	constructor(isRemote = false) {
		this.encodingSizes = new Map();
		this.encodingKeys = new Map();
		this.rootTypes = [];
		this.rootEntries = new Map();
		this.isRemote = isRemote;

		// Listen for configuration changes to cascLocale.
		this.unhookConfig = core.view.$watch('config.cascLocale', (locale) => {
			if (!isNaN(locale)) {
				this.locale = locale;
			} else {
				log.write('Invalid locale set in configuration, defaulting to enUS');
				this.locale = LocaleFlag.enUS;
			}
		}, { immediate: true });
	}

	/**
	 * Provides an array of fileDataIDs that match the current locale.
	 * @returns {Array.<number>}
	 */
	getValidRootEntries() {
		const entries = [];

		for (const [fileDataID, entry] of this.rootEntries.entries()) {
			let include = false;

			for (const rootTypeIdx of entry.keys()) {
				const rootType = this.rootTypes[rootTypeIdx];
				if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0)) {
					include = true;
					break;
				}
			}

			if (include)
				entries.push(fileDataID);
		}

		return entries;
	}

	/**
	 * Retrieves the install manifest for this CASC instance.
	 * @returns {InstallManifest}
	 */
	async getInstallManifest() {
		const installKeys = this.buildConfig.install.split(' ');
		const installKey = installKeys.length === 1 ? this.encodingKeys.get(installKeys[0]) : installKeys[1];

		const raw = this.isRemote ? await this.getDataFile(this.formatCDNKey(installKey)) : await this.getDataFileWithRemoteFallback(installKey);
		const manifest = new BLTEReader(raw, installKey);
		
		return new InstallManifest(manifest);
	}

	/**
	 * Check if a file exists by its fileDataID.
	 * @param {number} fileDataID 
	 * @returns {boolean}
	 */
	fileExists(fileDataID) {
		const root = this.rootEntries.get(fileDataID);
		if (root === undefined)
			return false;

		for (const [rootTypeIdx] of root.entries()) {
			const rootType = this.rootTypes[rootTypeIdx];
			if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0))
				return true;
		}

		return false;
	}

	/**
	 * Obtain a file by it's fileDataID.
	 * @param {number} fileDataID 
	 */
	async getFile(fileDataID) {
		const root = this.rootEntries.get(fileDataID);
		if (root === undefined)
			throw new Error('fileDataID does not exist in root: ' + fileDataID);

		let contentKey = null;
		for (const [rootTypeIdx, key] of root.entries()) {
			const rootType = this.rootTypes[rootTypeIdx];

			// Select the first root entry that has a matching locale and no LowViolence flag set.
			if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0)) {
				contentKey = key;
				break;
			}
		}

		if (contentKey === null)
			throw new Error('No root entry found for locale: ' + this.locale);

		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		// This underlying implementation returns the encoding key rather than a
		// data file, allowing CASCLocal and CASCRemote to implement readers.
		return encodingKey;
	}

	/**
	 * @param {string} contentKey 
	 * @returns {string}
	 */
	getEncodingKeyForContentKey(contentKey) {
		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		// This underlying implementation returns the encoding key rather than a
		// data file, allowing CASCLocal and CASCRemote to implement readers.
		return encodingKey;
	}

	/**
	 * Obtain a file by a filename.
	 * fileName must exist in the loaded listfile.
	 * @param {string} fileName
	 * @param {boolean} [partialDecrypt=false]
	 * @param {boolean} [suppressLog=false]
	 * @param {boolean} [supportFallback=true]
	 * @param {boolean} [forceFallback=false]
	 */
	async getFileByName(fileName, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false) {
		let fileDataID;

		// If filename is "unknown/<fdid>", skip listfile lookup
		if (fileName.startsWith("unknown/") && !fileName.includes('.')) {
			fileDataID = parseInt(fileName.split('/')[1]);
		} else {
			// try dbd manifest first for db2 files
			if (fileName.startsWith('DBFilesClient/') && fileName.endsWith('.db2')) {
				const table_name = fileName.substring(14, fileName.length - 4);
				fileDataID = dbd_manifest.getByTableName(table_name);
			}

			// fallback to listfile
			if (fileDataID === undefined)
				fileDataID = listfile.getByFilename(fileName);
		}

		if (fileDataID === undefined)
			throw new Error('File not mapping in listfile: ' + fileName);

		return await this.getFile(fileDataID, partialDecrypt, suppressLog, supportFallback, forceFallback);
	}

	/**
	 * get memory-mapped file by fileDataID.
	 * ensures file is in cache (unwrapped from BLTE), then returns bufferwrapper wrapping mmap.
	 * @param {number} fileDataID
	 * @param {boolean} [suppressLog=false]
	 * @returns {BufferWrapper} wrapper around memory-mapped file
	 */
	async getVirtualFileByID(fileDataID, suppressLog = false) {
		const root = this.rootEntries.get(fileDataID);
		if (root === undefined)
			throw new Error('fileDataID does not exist in root: ' + fileDataID);

		let contentKey = null;
		for (const [rootTypeIdx, key] of root.entries()) {
			const rootType = this.rootTypes[rootTypeIdx];

			if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlag.LowViolence) === 0)) {
				contentKey = key;
				break;
			}
		}

		if (contentKey === null)
			throw new Error('no root entry found for locale: ' + this.locale);

		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('no encoding entry found: ' + contentKey);

		const cachedPath = await this._ensureFileInCache(encodingKey, fileDataID, suppressLog);

		const mmap_obj = mmap.create_virtual_file();
		if (!mmap_obj.mapFile(cachedPath, { protection: 'readonly' }))
			throw new Error('failed to map file: ' + mmap_obj.lastError);

		return BufferWrapper.fromMmap(mmap_obj);
	}

	/**
	 * get memory-mapped file by filename.
	 * @param {string} fileName
	 * @param {boolean} [suppressLog=false]
	 * @returns {BufferWrapper} wrapper around memory-mapped file
	 */
	async getVirtualFileByName(fileName, suppressLog = false) {
		let fileDataID;

		if (fileName.startsWith("unknown/") && !fileName.includes('.')) {
			fileDataID = parseInt(fileName.split('/')[1]);
		} else {
			// try dbd manifest first for db2 files
			if (fileName.startsWith('DBFilesClient/') && fileName.endsWith('.db2')) {
				const table_name = fileName.substring(14, fileName.length - 4);
				fileDataID = dbd_manifest.getByTableName(table_name);
			}

			// fallback to listfile
			if (fileDataID === undefined)
				fileDataID = listfile.getByFilename(fileName);
		}

		if (fileDataID === undefined)
			throw new Error('file not mapping in listfile: ' + fileName);

		return await this.getVirtualFileByID(fileDataID, suppressLog);
	}

	/**
	 * Prepare listfile data before loading.
	 * Ensures preloading is complete to avoid race conditions.
	 */
	async prepareListfile() {
		await this.progress.step('Preparing listfiles...');
		await listfile.prepareListfile();
	}

	/**
	 * prepare dbd manifest before loading.
	 * ensures preloading is complete.
	 */
	async prepareDBDManifest() {
		await this.progress.step('Loading DBD manifest...');
		await dbd_manifest.prepareManifest();
	}

	/**
	 * Load the listfile for selected build.
	 * @param {string} buildKey 
	 */
	async loadListfile(buildKey) {
		await this.progress.step('Loading listfiles');
		listfile.applyPreload(this.rootEntries);
	}

	/**
	 * Returns an array of model formats to display.
	 * @returns {Array}
	 */
	getModelFormats() {
		// Filters for the model viewer depending on user settings.
		const modelExt = [];
		if (core.view.config.modelsShowM3)
			modelExt.push('.m3');

		if (core.view.config.modelsShowM2)
			modelExt.push('.m2');
		
		if (core.view.config.modelsShowWMO)
			modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

		return modelExt;
	}

	/**
	 * Initialize external components as part of the CASC load process.
	 * This allows us to do it seamlessly under the cover of the same loading screen.
	 */
	async initializeComponents() {
		await this.progress.step('Initializing components');
		await core.runLoadFuncs();
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
		const rootTypes = this.rootTypes;
		const rootEntries = this.rootEntries;

		if (magic == ROOT_MAGIC) { // 8.2
			let headerSize = root.readUInt32LE();
			let version = root.readUInt32LE();

			if (headerSize != 0x18) {
				version = 0; // This will break with future header size increases.
			} else {
				if (version != 1 && version != 2)
					throw new Error('Unknown root version: ' + version);
			}

			let totalFileCount;
			let namedFileCount;

			if (version == 0)
			{
				totalFileCount = headerSize;
				namedFileCount = version;
				headerSize = 12;
			}
			else
			{
				totalFileCount = root.readUInt32LE();
				namedFileCount = root.readUInt32LE();
			}

			root.seek(headerSize);

			const allowNamelessFiles = totalFileCount !== namedFileCount;
		
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32LE();
				
				let contentFlags;
				let localeFlags;

				if (version == 0 || version == 1) {
					contentFlags = root.readUInt32LE();
					localeFlags = root.readUInt32LE();
				} else if (version == 2) {
					localeFlags = root.readUInt32LE();
					const cflags1 = root.readUInt32LE();
					const cflags2 = root.readUInt32LE();
					const cflags3 = root.readUInt8();
					contentFlags = cflags1 | cflags2 | (cflags3 << 17);
				}

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, root.readHexString(16));
				}

				// Skip lookup hashes for entries.
				if (!(allowNamelessFiles && contentFlags & ContentFlag.NoNameHash))
					root.move(8 * numRecords);

				// Push the rootType after parsing the block so that
				// rootTypes.length can be used for the type index above.
				rootTypes.push({ contentFlags, localeFlags });
			}
		} else { // Classic
			root.seek(0);
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32LE();

				const contentFlags = root.readUInt32LE();
				const localeFlags = root.readUInt32LE();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const key = root.readHexString(16);
					root.move(8); // hash

					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, key);
				}

				// Push the rootType after parsing the block so that
				// rootTypes.length can be used for the type index above.
				rootTypes.push({ contentFlags, localeFlags });
			}
		}

		return rootEntries.size;
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

	/**
	 * Run any necessary clean-up once a CASC instance is no longer
	 * needed. At this point, the instance must be made eligible for GC.
	 */
	cleanup() {
		this.unhookConfig();
	}
}

module.exports = CASC;