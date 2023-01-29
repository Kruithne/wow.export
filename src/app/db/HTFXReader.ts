import fs from 'node:fs/promises';
import BufferWrapper from '../buffer';
import * as log from '../log';

/**
 * Reader for DBCache.bin (hotfix) files
 * @class HTFXReader
 */
export default class HTFXReader {
	tableHashMap: Map<string, string> = new Map();
	fileName: string;

	/**
     * Construct a new HTFXReader instance.
     * @param dbdManifest
     */
	constructor(dbdManifest: any) { // NIT: Dynamically loaded JSON thing
		this.fileName = this.locateDBCache();
		this.tableHashMap = new Map();
		dbdManifest.forEach((item: { tableHash: string; tableName: string; }) => this.tableHashMap.set(item.tableHash, item.tableName));
	}

	/**
     * Locate DBCache.bin for this product.
     */
	locateDBCache() : string {
		// TODO: Make work
		return 'C:\\World of Warcraft\\_retail_\\Cache\\ADB\\enUS\\DBCache.bin';
	}

	/**
     * Parse the hotfix file.
     */
	async parse(): Promise<void> {
		const data = new BufferWrapper(await fs.readFile(this.fileName));

		data.readUInt32LE(); // XFTH magic
		const version = data.readUInt32LE();

		if (version < 8 || version > 9)
			throw new Error('Unsupported DBCache.bin version: ' + version);

		// TODO: Verify if build is the same as currently loaded build (DBCache might be outdated)
		const build = data.readUInt32LE();

		data.readUInt32LE(8); // Verification hash (32 bytes)

		// Hotfix entries for the rest of the file
		while (data.remainingBytes) {
			const entryMagic = data.readUInt32LE(); // TODO: Verify

			data.readInt32LE(); // RegionID
			const pushID = data.readInt32LE() as number;
			data.readUInt32LE(); // UniqueID

			const tableHash = data.readUInt32LE().toString(16).toUpperCase().padStart(8, '0');

			const recordID = data.readUInt32LE() as number;
			const dataSize = data.readUInt32LE() as number;
			const status = data.readUInt8() as number;
			data.readUInt8(3); // Unused
			let recordData: number | number[];

			if(dataSize)
				recordData = data.readUInt8(dataSize as number);

			if (!this.tableHashMap.has(tableHash))
				log.write('Found hotfix for UNKNOWN TABLE %s, ID %s, PushID %s, Status %s', tableHash, recordID.toString(), pushID, status);
		}
	}
}