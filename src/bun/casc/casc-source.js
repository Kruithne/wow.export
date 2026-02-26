import path from 'node:path';
import { BLTEReader } from './blte-reader.js';
import * as listfile from './listfile.js';
import * as dbd_manifest from './dbd-manifest.js';
import * as log from '../lib/log.js';
import * as core from '../lib/core.js';
import * as constants from '../lib/constants.js';
import { flags as LocaleFlag } from './locale-flags.js';
import * as ContentFlag from './content-flags.js';
import InstallManifest from './install-manifest.js';
import BufferWrapper from '../lib/buffer.js';
import * as mmap from '../lib/mmap.js';

const ENC_MAGIC = 0x4E45;
const ROOT_MAGIC = 0x4D465354;

class CASC {
	constructor(isRemote = false) {
		this.encodingSizes = new Map();
		this.encodingKeys = new Map();
		this.rootTypes = [];
		this.rootEntries = new Map();
		this.isRemote = isRemote;

		this._configListener = ({ key, value }) => {
			if (key === 'cascLocale') {
				if (!isNaN(value))
					this.locale = value;
				else {
					log.write('Invalid locale set in configuration, defaulting to enUS');
					this.locale = LocaleFlag.enUS;
				}
			}
		};

		core.events.on('config-changed', this._configListener);

		// set initial locale
		const initial_locale = core.get_config('cascLocale');
		if (!isNaN(initial_locale))
			this.locale = initial_locale;
		else
			this.locale = LocaleFlag.enUS;
	}

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

	async getInstallManifest() {
		const installKeys = this.buildConfig.install.split(' ');
		const installKey = installKeys.length === 1 ? this.encodingKeys.get(installKeys[0]) : installKeys[1];

		const raw = this.isRemote ? await this.getDataFile(this.formatCDNKey(installKey)) : await this.getDataFileWithRemoteFallback(installKey);
		const manifest = new BLTEReader(raw, installKey);

		return new InstallManifest(manifest);
	}

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

	async getFile(fileDataID) {
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
			throw new Error('No root entry found for locale: ' + this.locale);

		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		return encodingKey;
	}

	getEncodingKeyForContentKey(contentKey) {
		const encodingKey = this.encodingKeys.get(contentKey);
		if (encodingKey === undefined)
			throw new Error('No encoding entry found: ' + contentKey);

		return encodingKey;
	}

	async getFileEncodingInfo(fileDataID) {
		try {
			const encodingKey = await this.getFile(fileDataID);
			return { enc: encodingKey };
		} catch {
			return null;
		}
	}

	async getFileByName(fileName, partialDecrypt = false, suppressLog = false, supportFallback = true, forceFallback = false) {
		let fileDataID;

		if (fileName.startsWith('unknown/') && !fileName.includes('.')) {
			fileDataID = parseInt(fileName.split('/')[1]);
		} else {
			if (fileName.startsWith('DBFilesClient/') && fileName.endsWith('.db2')) {
				const table_name = fileName.substring(14, fileName.length - 4);
				fileDataID = dbd_manifest.getByTableName(table_name);
			}

			if (fileDataID === undefined)
				fileDataID = listfile.getByFilename(fileName);
		}

		if (fileDataID === undefined)
			throw new Error('File not mapping in listfile: ' + fileName);

		return await this.getFile(fileDataID, partialDecrypt, suppressLog, supportFallback, forceFallback);
	}

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

	async getVirtualFileByName(fileName, suppressLog = false) {
		let fileDataID;

		if (fileName.startsWith('unknown/') && !fileName.includes('.')) {
			fileDataID = parseInt(fileName.split('/')[1]);
		} else {
			if (fileName.startsWith('DBFilesClient/') && fileName.endsWith('.db2')) {
				const table_name = fileName.substring(14, fileName.length - 4);
				fileDataID = dbd_manifest.getByTableName(table_name);
			}

			if (fileDataID === undefined)
				fileDataID = listfile.getByFilename(fileName);
		}

		if (fileDataID === undefined)
			throw new Error('file not mapping in listfile: ' + fileName);

		return await this.getVirtualFileByID(fileDataID, suppressLog);
	}

	async prepareListfile() {
		await core.progress_loading_screen('Preparing listfiles...');
		await listfile.prepareListfile();
	}

	async prepareDBDManifest() {
		await core.progress_loading_screen('Loading DBD manifest...');
		await dbd_manifest.prepareManifest();
	}

	async loadListfile(buildKey) {
		await core.progress_loading_screen('Loading listfiles');
		listfile.applyPreload(this.rootEntries);
	}

	getModelFormats() {
		const modelExt = [];
		if (core.get_config('modelsShowM3'))
			modelExt.push('.m3');

		if (core.get_config('modelsShowM2'))
			modelExt.push('.m2');

		if (core.get_config('modelsShowWMO'))
			modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

		return modelExt;
	}

	async parseRootFile(data, hash) {
		const root = new BLTEReader(data, hash);

		const magic = root.readUInt32LE();
		const rootTypes = this.rootTypes;
		const rootEntries = this.rootEntries;

		if (magic == ROOT_MAGIC) {
			let headerSize = root.readUInt32LE();
			let version = root.readUInt32LE();

			if (headerSize != 0x18) {
				version = 0;
			} else {
				if (version != 1 && version != 2)
					throw new Error('Unknown root version: ' + version);
			}

			let totalFileCount;
			let namedFileCount;

			if (version == 0) {
				totalFileCount = headerSize;
				namedFileCount = version;
				headerSize = 12;
			} else {
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
				for (let i = 0; i < numRecords; i++) {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				for (let i = 0; i < numRecords; i++) {
					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, root.readHexString(16));
				}

				if (!(allowNamelessFiles && contentFlags & ContentFlag.NoNameHash))
					root.move(8 * numRecords);

				rootTypes.push({ contentFlags, localeFlags });
			}
		} else {
			root.seek(0);
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32LE();

				const contentFlags = root.readUInt32LE();
				const localeFlags = root.readUInt32LE();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++) {
					const nextID = fileDataID + root.readInt32LE();
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				for (let i = 0; i < numRecords; i++) {
					const key = root.readHexString(16);
					root.move(8);

					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, key);
				}

				rootTypes.push({ contentFlags, localeFlags });
			}
		}

		return rootEntries.size;
	}

	async parseEncodingFile(data, hash) {
		const encodingSizes = this.encodingSizes;
		const encodingKeys = this.encodingKeys;

		const encoding = new BLTEReader(data, hash);

		const magic = encoding.readUInt16LE();
		if (magic !== ENC_MAGIC)
			throw new Error('Invalid encoding magic: ' + magic);

		encoding.move(1);
		const hashSizeCKey = encoding.readUInt8();
		const hashSizeEKey = encoding.readUInt8();
		const cKeyPageSize = encoding.readInt16BE() * 1024;
		encoding.move(2);
		const cKeyPageCount = encoding.readInt32BE();
		encoding.move(4 + 1);
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

	cleanup() {
		core.events.off('config-changed', this._configListener);
	}
}

export default CASC;
