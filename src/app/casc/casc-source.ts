/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import BLTEReader from './blte-reader';

import Listfile, { ListfileFilter } from './listfile';
import Log from '../log';
import { state } from '../core';
import Events from '../events';
import Constants from '../constants';
import BufferWrapper from '../buffer';
import ProgressObject from '../progress-object';

import { LocaleFlags } from './locale-flags';
import { ContentFlags } from './content-flags';
import InstallManifest from  './install-manifest';
import WDCReader from '../db/WDCReader';
import CASCRemote from './casc-source-remote';
import CASCLocal from './casc-source-local';
import BuildCache from './build-cache';

import * as DBTextureFileData from '../db/caches/DBTextureFileData';
import * as DBModelFileData from '../db/caches/DBModelFileData';
import * as DBItemDisplays from '../db/caches/DBItemDisplays';
import * as DBCreatures from '../db/caches/DBCreatures';

import * as VersionConfig from './version-config';

const ENC_MAGIC = 0x4E45;
const ROOT_MAGIC = 0x4D465354;

type RootType = {
	localeFlags: number;
	contentFlags: number;
}

export default abstract class CASC {
	locale: LocaleFlags;
	isRemote: boolean;
	unhookConfig: () => void;
	encodingSizes: Map<string, number> = new Map();
	encodingKeys: Map<string, string> = new Map();
	progress: ProgressObject;
	rootEntries: Map<number, Map<number, string>> = new Map();
	rootTypes: Array<RootType>;
	cache: BuildCache;
	buildConfig: Record<string, string>;
	cdnConfig: Record<string, string>;
	serverConfig: Record<string, string>;

	builds: Array<VersionConfig.BuildInfo>;
	build: VersionConfig.BuildInfo;

	/**
	 * Construct a new CASC instance.
	 * @param isRemote - Whether this CASC instance is remote or not.
	 */
	constructor(isRemote = false) {
		this.rootTypes = [];
		this.isRemote = isRemote;

		this.progress = state.createProgress(10);

		// Listen for configuration changes to cascLocale.
		this.unhookConfig = state.$watch('config.cascLocale', (locale: number) => {
			if (!isNaN(locale)) {
				this.locale = locale;
			} else {
				Log.write('Invalid locale set in configuration, defaulting to enUS');
				this.locale = LocaleFlags.enUS;
			}
		}, { immediate: true });
	}

	/**
	 * Provides an array of fileDataIDs that match the current locale.
	 * @returns An array of fileDataIDs.
	 */
	getValidRootEntries(): Array<number> {
		const entries: Array<number> = [];

		for (const [fileDataID, entry] of this.rootEntries.entries()) {
			let include = false;

			for (const rootTypeIdx of entry.keys()) {
				const rootType = this.rootTypes[rootTypeIdx];
				if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlags.LowViolence) === 0)) {
					include = true;
					break;
				}
			}

			if (include)
				entries.push(fileDataID);
		}

		return entries;
	}

	abstract load(buildIndex: number): Promise<void>;
	abstract init(): Promise<void>;
	abstract getProductList(): Array<string>;

	/**
	 * Retrieves the install manifest for this CASC instance.
	 * @returns
	 */
	async getInstallManifest(): Promise<InstallManifest> {
		const installKeys = this.buildConfig.install.split(' ');
		const installKey = installKeys.length === 1 ? this.encodingKeys.get(installKeys[0]) : installKeys[1];

		const raw = this.isRemote ? await (this as unknown as CASCRemote).getDataFile((this as unknown as CASCRemote).formatCDNKey(installKey)) : await (this as unknown as CASCLocal).getDataFileWithRemoteFallback(installKey);
		const manifest = new BLTEReader(raw, installKey);

		return new InstallManifest(manifest);
	}

	/**
	 * Retrieves a file from the CASC instance.
	 * @param fileDataID - The fileDataID of the file to retrieve.
	 * @param partialDecryption - Whether to use partial decryption or not.
	 * @param suppressLog - Whether to suppress logging or not.
	 * @param supportFallback - Whether to support fallback or not.
	 * @param forceFallback - Whether to force fallback or not.
	 * @param contentKey - The content key to use for the file.
	 */
	abstract getFile(fileDataID: number, partialDecryption?: boolean, suppressLog?: boolean, supportFallback?: boolean, forceFallback?: boolean, contentKey?: string | null): Promise<BLTEReader>;

	/**
	 * Obtain the encoding key for a file.
	 * @param fileDataID
	 * @returns The encoding key.
	 */
	async getEncodingKey(fileDataID: number): Promise<string> {
		const root = this.rootEntries.get(fileDataID);
		if (root === undefined)
			throw new Error('fileDataID does not exist in root: ' + fileDataID);

		let contentKey: string | null = null;
		for (const [rootTypeIdx, key] of root.entries()) {
			const rootType = this.rootTypes[rootTypeIdx];

			// Select the first root entry that has a matching locale and no LowViolence flag set.
			if ((rootType.localeFlags & this.locale) && ((rootType.contentFlags & ContentFlags.LowViolence) === 0)) {
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
	 * @param contentKey
	 * @returns
	 */
	getEncodingKeyForContentKey(contentKey: string): string {
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
	async getFileByName(fileName: string, partialDecrypt: boolean = false, suppressLog: boolean = false, supportFallback: boolean = true, forceFallback: boolean = false): Promise<BLTEReader> {
		const fileDataID = Listfile.getByFilename(fileName);
		if (fileDataID === undefined)
			throw new Error('File not mapping in listfile: ' + fileName);

		return await this.getFile(fileDataID, partialDecrypt, suppressLog, supportFallback, forceFallback);
	}

	/**
	 * Load the listfile for selected build.
	 * @param buildKey
	 */
	async loadListfile(buildKey: string): Promise<void> {
		await this.progress.step('Loading listfile');
		const entries = await Listfile.loadListfile(buildKey, this.cache, this.rootEntries);
		if (entries === 0)
			throw new Error('No listfile entries found');
	}

	/**
	 * Returns an array of model formats to display.
	 * @returns
	 */
	getModelFormats(): Array<ListfileFilter> {
		// Filters for the model viewer depending on user settings.
		const modelExt = new Array<ListfileFilter>();
		if (state.config.modelsShowM2)
			modelExt.push('.m2');

		if (state.config.modelsShowWMO)
			modelExt.push({ ext: '.wmo', pattern: Constants.LISTFILE_MODEL_FILTER });

		return modelExt;
	}

	updateListfileFilters(): void {
		state.listfileTextures = Listfile.getFilenamesByExtension('.blp');
		state.listfileSounds = Listfile.getFilenamesByExtension('.ogg', '.mp3', '.unk_sound');
		state.listfileVideos = Listfile.getFilenamesByExtension('.avi');
		state.listfileText = Listfile.getFilenamesByExtension('.txt', '.lua', '.xml', '.sbt', '.wtf', '.htm', '.toc', '.xsd');
		state.listfileModels = Listfile.getFilenamesByExtension(...this.getModelFormats());
		state.listfileDB2s = Listfile.getFilenamesByExtension('.db2');
	}

	/**
	 * Creates filtered versions of the master listfile.
	 */
	async filterListfile(): Promise<void> {
		// Pre-filter extensions for tabs.
		await this.progress.step('Filtering listfiles');

		Events.on('listfile:needs-updating', () => this.updateListfileFilters());

		state.$watch('config.listfileSortByID', () => Events.emit('listfile:needs-updating'));
		state.$watch('config.listfileShowFileDataIDs', () => Events.emit('listfile:needs-updating'), { immediate: true });
	}

	/**
	 * Load tables that are required globally.
	 */
	async loadTables(): Promise<void> {
		await this.progress.step('Loading model file data');
		await DBModelFileData.initializeModelFileData();

		await this.progress.step('Loading texture file data');
		await DBTextureFileData.initializeTextureFileData();

		// Once the above two tables have loaded, ingest fileDataIDs as
		// unknown entries to the listfile.
		if (state.config.enableUnknownFiles) {
			this.progress.step('Checking data tables for unknown files');
			await Listfile.loadUnknowns();
		} else {
			await this.progress.step();
		}

		if (state.config.enableM2Skins) {
			await this.progress.step('Loading item displays');
			await DBItemDisplays.initializeItemDisplays();

			await this.progress.step('Loading creature data');
			const creatureDisplayInfo = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2');
			await creatureDisplayInfo.parse();

			if (!creatureDisplayInfo.schema.has('ModelID') || !creatureDisplayInfo.schema.has('TextureVariationFileDataID')) {
				Log.write('Unable to load creature textures, CreatureDisplayInfo is missing required fields.');
				state.setToast('error', 'Creature data failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
					'Clear Cache': () => Events.emit('click-cache-clear'),
					'Not Now': () => false
				}, -1, false);
				return;
			}

			const creatureModelData = new WDCReader('DBFilesClient/CreatureModelData.db2');
			await creatureModelData.parse();

			if (!creatureModelData.schema.has('FileDataID') || !creatureModelData.schema.has('CreatureGeosetDataID')) {
				Log.write('Unable to load creature textures, CreatureModelData is missing required fields.');
				state.setToast('error', 'Creature data failed to load due to outdated/incorrect database definitions. Clearing your cache might fix this.', {
					'Clear Cache': () => Events.emit('click-cache-clear'),
					'Not Now': () => false
				}, -1, false);
				return;
			}

			await DBCreatures.initializeCreatureData(creatureDisplayInfo, creatureModelData);
		} else {
			await this.progress.step();
		}
	}

	/**
	 * Initialize external components as part of the CASC load process.
	 * This allows us to do it seamlessly under the cover of the same loading screen.
	 */
	async initializeComponents(): Promise<void> {
		await this.progress.step('Initializing components');
		return Events.emitAndAwait('casc:initialized');
	}

	/**
	 * Parse entries from a root file.
	 * @param {BufferWrapper} data
	 * @param {string} hash
	 * @returns {number}
	 */
	async parseRootFile(data: BufferWrapper, hash: string): Promise<number> {
		const root = new BLTEReader(data, hash);

		const magic = root.readUInt32();
		const rootTypes = this.rootTypes;
		const rootEntries = this.rootEntries;

		if (magic == ROOT_MAGIC) { // 8.2
			const totalFileCount = root.readUInt32();
			const namedFileCount = root.readUInt32();
			const allowNamelessFiles = totalFileCount !== namedFileCount;

			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32() as number;

				const contentFlags = root.readUInt32() as number;
				const localeFlags = root.readUInt32();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + (root.readInt32() as number);
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const fileDataID = fileDataIDs[i];
					let entry = rootEntries.get(fileDataID);

					if (!entry) {
						entry = new Map<number, string>();
						rootEntries.set(fileDataID, entry);
					}

					entry.set(rootTypes.length, root.readString(16, 'hex'));
				}

				// Skip lookup hashes for entries.
				if (!(allowNamelessFiles && contentFlags & ContentFlags.NoNameHash))
					root.move(8 * numRecords);

				// Push the rootType after parsing the block so that
				// rootTypes.length can be used for the type index above.
				rootTypes.push({ contentFlags, localeFlags });
			}
		} else { // Classic
			root.seek(0);
			while (root.remainingBytes > 0) {
				const numRecords = root.readUInt32() as number;

				const contentFlags = root.readUInt32();
				const localeFlags = root.readUInt32();

				const fileDataIDs = new Array(numRecords);

				let fileDataID = 0;
				for (let i = 0; i < numRecords; i++)  {
					const nextID = fileDataID + (root.readInt32() as number);
					fileDataIDs[i] = nextID;
					fileDataID = nextID + 1;
				}

				// Parse MD5 content keys for entries.
				for (let i = 0; i < numRecords; i++) {
					const key = root.readString(16, 'hex');
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
	 * @param data - The data to parse.
	 * @param hash - The hash of the data.
	 */
	async parseEncodingFile(data: BufferWrapper, hash: string): Promise<void> {
		const encodingSizes = this.encodingSizes;
		const encodingKeys = this.encodingKeys;

		const encoding = new BLTEReader(data, hash);

		const magic = encoding.readUInt16();
		if (magic !== ENC_MAGIC)
			throw new Error('Invalid encoding magic: ' + magic);

		encoding.move(1); // version
		const hashSizeCKey = encoding.readUInt8() as number;
		const hashSizeEKey = encoding.readUInt8() as number;
		const cKeyPageSize = encoding.readInt16BE() as number * 1024;
		encoding.move(2); // eKeyPageSize
		const cKeyPageCount = encoding.readInt32BE() as number;
		encoding.move(4 + 1); // eKeyPageCount + unk11
		const specBlockSize = encoding.readInt32BE() as number;

		encoding.move(specBlockSize + (cKeyPageCount * (hashSizeCKey + 16)));

		const pagesStart = encoding.offset;
		for (let i = 0; i < cKeyPageCount; i++) {
			const pageStart = pagesStart + (cKeyPageSize * i);
			encoding.seek(pageStart);

			while (encoding.offset < (pageStart + pagesStart)) {
				const keysCount = encoding.readUInt8() as number;
				if (keysCount === 0)
					break;

				const size = encoding.readInt40BE() as number;
				const cKey = encoding.readString(hashSizeCKey, 'hex');

				encodingSizes.set(cKey, size);
				encodingKeys.set(cKey, encoding.readString(hashSizeEKey, 'hex'));

				encoding.move(hashSizeEKey * (keysCount - 1));
			}
		}
	}

	/**
	 * Run any necessary clean-up once a CASC instance is no longer
	 * needed. At this point, the instance must be made eligible for GC.
	 */
	cleanup(): void {
		this.unhookConfig();
	}
}
