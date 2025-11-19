/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const util = require('util');
const path = require('path');
const assert = require('assert').strict;
const log = require('../log');
const core = require('../core');
const generics = require('../generics');
const constants = require('../constants');

const ExportHelper = require('../casc/export-helper');
const DBDParser = require('./DBDParser');

const FieldType = require('./FieldType');
const CompressionType = require('./CompressionType');
const BufferWrapper = require('../buffer');

const TABLE_FORMATS = {
	0x32434457: { name: 'WDC2', wdcVersion: 2 },
	0x434C5331: { name: 'CLS1', wdcVersion: 2 },
	0x33434457: { name: 'WDC3', wdcVersion: 3 },
	0x34434457: { name: 'WDC4', wdcVersion: 4 },
	0x35434457: { name: 'WDC5', wdcVersion: 5 },
};


/**
 * Returns the schema type symbol for a DBD field.
 * @param {DBDField} entry 
 * @returns {symbol}
 */
const convertDBDToSchemaType = (entry) => {
	if (!entry.isInline && entry.isRelation)
		return FieldType.Relation;

	if (!entry.isInline && entry.isID)
		return FieldType.NonInlineID;

	// TODO: Handle string separate to locstring in the event we need it.
	if (entry.type === 'string' || entry.type === 'locstring')
		return FieldType.String;

	if (entry.type === 'float')
		return FieldType.Float;

	if (entry.type === 'int') {
		switch (entry.size) {
			case 8: return entry.isSigned ? FieldType.Int8 : FieldType.UInt8;
			case 16: return entry.isSigned ? FieldType.Int16 : FieldType.UInt16;
			case 32: return entry.isSigned ? FieldType.Int32 : FieldType.UInt32;
			case 64: return entry.isSigned ? FieldType.Int64 : FieldType.UInt64;
			default: throw new Error('Unsupported DBD integer size ' + entry.size);
		}
	}

	throw new Error('Unrecognized DBD type ' + entry.type);
};

/**
 * Defines unified logic between WDC2 and WDC3.
 * @class WDC
 */
class WDCReader {
	/**
	 * Construct a new WDCReader instance.
	 * @param {string} fileName
	 */
	constructor(fileName) {
		this.fileName = fileName;

		this.copyTable = new Map();

		this.schema = new Map();

		this.isLoaded = false;
		this.idField = null;
		this.idFieldIndex = null;

		this.relationshipLookup = new Map();

		// preloaded rows cache (null = not preloaded)
		this.rows = null;

		// lazy-loading metadata
		this.data = null;
		this.sections = null;
		this.fieldInfo = null;
		this.palletData = null;
		this.commonData = null;
		this.castBuffer = null;
		this.recordCount = 0;
		this.recordSize = 0;
		this.flags = 0;
		this.wdcVersion = 0;
		this.minID = 0;
		this.maxID = 0;
		this.totalRecordCount = 0;
	}

	/**
	 * Returns the amount of rows available in the table.
	 */
	get size() {
		return this.totalRecordCount + this.copyTable.size;
	}
	
	/**
	 * Get a row from this table.
	 * Returns NULL if the row does not exist.
	 * @param {number} recordID
	 */
	getRow(recordID) {
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table row before table was loaded.');

		recordID = parseInt(recordID);

		// check copy table first
		const copyID = this.copyTable.get(recordID);
		if (copyID !== undefined) {
			const copy = this._readRecord(copyID);
			if (copy !== null) {
				let tempCopy = Object.assign({}, copy);
				tempCopy.ID = recordID;
				return tempCopy;
			}
		}

		// read record directly
		return this._readRecord(recordID);
	}

	/**
	 * Returns all available rows in the table.
	 * If preload() was called, returns cached rows. Otherwise computes fresh.
	 * Iterates sequentially through all sections for efficient paging with mmap.
	 */
	getAllRows() {
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table rows before table was loaded.');

		// return preloaded cache if available
		if (this.rows !== null)
			return this.rows;

		const rows = new Map();

		// iterate through all sections sequentially
		for (let sectionIndex = 0; sectionIndex < this.sections.length; sectionIndex++) {
			const section = this.sections[sectionIndex];
			const header = section.header;

			// skip encrypted sections
			if (section.isEncrypted)
				continue;

			const hasIDMap = section.idList.length > 0;
			const emptyIDMap = hasIDMap && section.idList.every(id => id === 0);

			for (let i = 0; i < header.recordCount; i++) {
				let recordID;

				if (hasIDMap && emptyIDMap) {
					recordID = i;
				} else if (hasIDMap) {
					recordID = section.idList[i];
				}

				// if no ID map, recordID will be determined during record parsing from inline ID field
				const record = this._readRecordFromSection(sectionIndex, i, recordID);
				if (record !== null) {
					// use the ID from the record if we didn't have it upfront
					const finalRecordID = recordID !== undefined ? recordID : record[this.idField];
					rows.set(finalRecordID, record);
				}
			}
		}

		// inflate copy table
		for (const [destID, srcID] of this.copyTable) {
			const src = rows.get(srcID);
			if (src !== undefined) {
				let rowData = Object.assign({}, src);
				rowData.ID = destID;
				rows.set(destID, rowData);
			}
		}

		return rows;
	}

	/**
	 * Preload all rows into memory cache.
	 * Subsequent calls to getAllRows() will return cached data.
	 * Required for getRelationRows() to work properly.
	 */
	preload() {
		if (!this.isLoaded)
			throw new Error('Attempted to preload table before it was loaded.');

		if (this.rows !== null)
			return;

		this.rows = this.getAllRows();
	}

	/**
	 * Get rows by foreign key value (uses relationship maps).
	 * Returns empty array if no rows found or table has no relationship data.
	 * @param {number} foreignKeyValue - The FK value to search for
	 * @returns {Array} Array of matching row objects
	 */
	getRelationRows(foreignKeyValue) {
		if (!this.isLoaded)
			throw new Error('Attempted to query relationship data before table was loaded.');

		foreignKeyValue = parseInt(foreignKeyValue);

		const recordIDs = this.relationshipLookup.get(foreignKeyValue);
		if (!recordIDs || recordIDs.length === 0)
			return [];

		const results = [];
		for (const recordID of recordIDs) {
			const row = this._readRecord(recordID);
			if (row !== null)
				results.push(row);
		}

		return results;
	}

/**
	 * Load the schema for this table.
	 * @param {string} layoutHash
	 */
	async loadSchema(layoutHash) {
		const casc = core.view.casc;
		const buildID = casc.getBuildName();

		const tableName = ExportHelper.replaceExtension(path.basename(this.fileName));
		const dbdName = tableName + '.dbd';

		let structure = null;
		log.write('Loading table definitions %s (%s %s)...', dbdName, buildID, layoutHash);

		// check cached dbd
		let rawDbd = await casc.cache.getFile(dbdName, constants.CACHE.DIR_DBD);
		if (rawDbd !== null)
			structure = new DBDParser(rawDbd).getStructure(buildID, layoutHash);

		// download if not cached
		if (structure === null) {
			const dbd_url = util.format(core.view.config.dbdURL, tableName);
			const dbd_url_fallback = util.format(core.view.config.dbdFallbackURL, tableName);

			try {
				log.write(`No cached DBD, downloading new from ${dbd_url}`);
				rawDbd = await generics.downloadFile([dbd_url, dbd_url_fallback]);

				await casc.cache.storeFile(dbdName, rawDbd, constants.CACHE.DIR_DBD);

				structure = new DBDParser(rawDbd).getStructure(buildID, layoutHash);
			} catch (e) {
				log.write(e);
				throw new Error('Unable to download DBD for ' + tableName);
			}
		}

		if (structure === null)
			throw new Error('No table definition available for ' + tableName);

		this.buildSchemaFromDBDStructure(structure);
	}

	/**
	 * Builds a schema for this data table using the provided DBD structure.
	 * @param {DBDEntry} structure 
	 */
	buildSchemaFromDBDStructure(structure) {
		for (const field of structure.fields) {
			const fieldType = convertDBDToSchemaType(field);
			if (field.arrayLength > -1)
				this.schema.set(field.name, [fieldType, field.arrayLength]);
			else
				this.schema.set(field.name, fieldType);
		}
	}

	/**
	 * Gets index of ID field
	 */
	getIDIndex() {
		if (!this.isLoaded)
			throw new Error('Attempted to get ID index before table was loaded.');

		return this.idFieldIndex;
	}

	async parse() {
		log.write('Loading DB file %s from CASC', this.fileName);

		const data = await core.view.casc.getVirtualFileByName(this.fileName, false);
		this.data = data;

		// store reference for lazy-loading
		this.castBuffer = BufferWrapper.alloc(8, true);

		// wdc_magic
		const magic = data.readUInt32LE();
		const format = TABLE_FORMATS[magic];

		if (!format)
			throw new Error('Unsupported DB2 type: ' + magic);

		const wdcVersion = format.wdcVersion;
		log.write('Processing DB file %s as %s', this.fileName, format.name);

		// Skip over WDC5 specific information for now
		if (wdcVersion === 5) {
			data.readUInt32LE(); // Schema version?
			data.readUInt8(128); // Schema build string
		}

		// wdc_db2_header
		this.recordCount = data.readUInt32LE();
		data.move(4); // fieldCount
		this.recordSize = data.readUInt32LE();
		data.move(4); // stringTableSize
		data.move(4); // tableHash
		const layoutHash = data.readUInt8(4).reverse().map(e => e.toString(16).padStart(2, '0')).join('').toUpperCase();
		this.minID = data.readUInt32LE();
		this.maxID = data.readUInt32LE();
		data.move(4); // locale
		this.flags = data.readUInt16LE();
		const idIndex = data.readUInt16LE();
		this.idFieldIndex = idIndex;
		const totalFieldCount = data.readUInt32LE();
		data.move(4); // bitpackedDataOffset
		data.move(4); // lookupColumnCount
		const fieldStorageInfoSize = data.readUInt32LE();
		const commonDataSize = data.readUInt32LE();
		const palletDataSize = data.readUInt32LE();
		const sectionCount = data.readUInt32LE();

		this.wdcVersion = wdcVersion;

		// Load the DBD and parse a schema from it.
		await this.loadSchema(layoutHash);

		// wdc_section_header section_headers[section_count]
		const sectionHeaders = new Array(sectionCount);
		for (let i = 0; i < sectionCount; i++) {
			sectionHeaders[i] = wdcVersion === 2 ? {
				tactKeyHash: data.readUInt64LE(),
				fileOffset: data.readUInt32LE(),
				recordCount: data.readUInt32LE(),
				stringTableSize: data.readUInt32LE(),
				copyTableSize: data.readUInt32LE(),
				offsetMapOffset: data.readUInt32LE(),
				idListSize: data.readUInt32LE(),
				relationshipDataSize: data.readUInt32LE()
			} : {
				tactKeyHash: data.readUInt64LE(),
				fileOffset: data.readUInt32LE(),
				recordCount: data.readUInt32LE(),
				stringTableSize: data.readUInt32LE(),
				offsetRecordsEnd: data.readUInt32LE(),
				idListSize: data.readUInt32LE(),
				relationshipDataSize: data.readUInt32LE(),
				offsetMapIDCount: data.readUInt32LE(),
				copyTableCount: data.readUInt32LE()
			};
		}

		// fields[header.total_field_count]
		const fields = new Array(totalFieldCount);
		for (let i = 0; i < totalFieldCount; i++)
			fields[i] = { size: data.readInt16LE(), position: data.readUInt16LE() };

		// field_info[header.field_storage_info_size / sizeof(field_storage_info)]
		this.fieldInfo = new Array(fieldStorageInfoSize / (4 * 6));
		for (let i = 0, n = this.fieldInfo.length; i < n; i++) {
			this.fieldInfo[i] = {
				fieldOffsetBits: data.readUInt16LE(),
				fieldSizeBits: data.readUInt16LE(),
				additionalDataSize: data.readUInt32LE(),
				fieldCompression: data.readUInt32LE(),
				fieldCompressionPacking: data.readUInt32LE(3)
			};
		}

		// char pallet_data[header.pallet_data_size];
		let prevPos = data.offset;

		this.palletData = new Array(this.fieldInfo.length);
		for (let fieldIndex = 0, nFields = this.fieldInfo.length; fieldIndex < nFields; fieldIndex++) {
			const thisFieldInfo = this.fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexed || thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
				this.palletData[fieldIndex] = new Array();
				for (let i = 0; i < thisFieldInfo.additionalDataSize / 4; i++)
					this.palletData[fieldIndex][i] = data.readUInt32LE();
			}
		}

		// Ensure we've read the expected amount of pallet data.
		assert.strictEqual(data.offset, prevPos + palletDataSize, 'Read incorrect amount of pallet data');

		prevPos = data.offset;

		// char common_data[header.common_data_size];
		this.commonData = new Array(this.fieldInfo.length);
		for (let fieldIndex = 0, nFields = this.fieldInfo.length; fieldIndex < nFields; fieldIndex++) {
			const thisFieldInfo = this.fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.CommonData) {
				const commonDataMap = this.commonData[fieldIndex] = new Map();

				for (let i = 0; i < thisFieldInfo.additionalDataSize / 8; i++)
					commonDataMap.set(data.readUInt32LE(), data.readUInt32LE());
			}
		}

		// Ensure we've read the expected amount of common data.
		assert.strictEqual(data.offset, prevPos + commonDataSize, 'Read incorrect amount of common data');

		// New WDC4 chunk: TODO read
		if (wdcVersion > 3) {
			for (let sectionIndex = 0; sectionIndex < sectionCount - 1; sectionIndex++) {
				let entryCount = data.readUInt32LE();
				data.move(entryCount * 4);
			}
		}

		// data_sections[header.section_count];
		this.sections = new Array(sectionCount);
		const copyTable = this.copyTable;
		let previousStringTableSize = 0;
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const header = sectionHeaders[sectionIndex];
			const isNormal = !(this.flags & 1);

			const recordDataOfs = data.offset;
			const recordsOfs = wdcVersion === 2 ? header.offsetMapOffset : header.offsetRecordsEnd;
			const recordDataSize = isNormal ? this.recordSize * header.recordCount : recordsOfs - header.fileOffset;
			const stringBlockOfs = recordDataOfs + recordDataSize;

			let offsetMap;
			if (wdcVersion === 2 && !isNormal) {
				data.seek(header.offsetMapOffset);
				// offset_map_entry offset_map[header.max_id - header.min_id + 1];
				const offsetMapCount = this.maxID - this.minID + 1;
				offsetMap = new Array(offsetMapCount);
				for (let i = 0, n = offsetMapCount; i < n; i++)
					offsetMap[this.minID + i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };
			}

			// store string table offset for lazy access
			const stringTableOffset = stringBlockOfs;
			const stringTableOffsetBase = previousStringTableSize;

			if (wdcVersion > 2)
				previousStringTableSize += header.stringTableSize;

			data.seek(stringBlockOfs + header.stringTableSize);

			// uint32_t id_list[section_headers.id_list_size / 4];
			const idList = data.readUInt32LE(header.idListSize / 4);

			// copy_table_entry copy_table[section_headers.copy_table_count];
			const copyTableCount = wdcVersion === 2 ? (header.copyTableSize / 8) : header.copyTableCount
			for (let i = 0; i < copyTableCount; i++) {
				let destinationRowID = data.readInt32LE();
				let sourceRowID = data.readInt32LE();
				if (destinationRowID != sourceRowID)
					copyTable.set(destinationRowID, sourceRowID);
			}

			if (wdcVersion > 2) {
				// offset_map_entry offset_map[section_headers.offset_map_id_count];
				offsetMap = new Array(header.offsetMapIDCount);
				for (let i = 0, n = header.offsetMapIDCount; i < n; i++)
					offsetMap[i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };
			}

			prevPos = data.offset;

			// relationship_map
			let relationshipMap;

			if (header.relationshipDataSize > 0) {
				const relationshipEntryCount = data.readUInt32LE();
				data.move(8); // relationshipMinID (UInt32) and relationshipMaxID (UInt32)

				relationshipMap = new Map();
				for (let i = 0; i < relationshipEntryCount; i++) {
					const foreignID = data.readUInt32LE();
					const recordIndex = data.readUInt32LE();
					relationshipMap.set(recordIndex, foreignID);

					// populate relationship lookup
					if (!this.relationshipLookup.has(foreignID))
						this.relationshipLookup.set(foreignID, []);
				}

				// If a section is encrypted it is highly likely we don't read the correct amount of data here. Skip ahead if so.
				if (prevPos + header.relationshipDataSize != data.offset)
					data.seek(prevPos + header.relationshipDataSize);
			}

			// uint32_t offset_map_id_list[section_headers.offset_map_id_count];
			// Duplicate of id_list for sections with offset records.
			if (wdcVersion > 2)
				data.move(header.offsetMapIDCount * 4);

			this.sections[sectionIndex] = { header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, stringTableOffset, stringTableOffsetBase, idList, offsetMap, relationshipMap, isEncrypted: false };
		}

		// detect encrypted sections and count total records
		this.totalRecordCount = 0;
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const section = this.sections[sectionIndex];
			const header = section.header;
			const offsetMap = section.offsetMap;
			const isNormal = section.isNormal;

			// skip parsing entries from encrypted sections
			if (header.tactKeyHash !== BigInt(0)) {
				let isZeroed = true;

				// check if record data is all zeroes
				data.seek(section.recordDataOfs);
				for (let i = 0, n = section.recordDataSize; i < n; i++) {
					if (data.readUInt8() !== 0x0) {
						isZeroed = false;
						break;
					}
				}

				// check if first integer after string block (from id list or copy table) is non-0
				if (isZeroed && (wdcVersion > 2) && isNormal && (header.idListSize > 0 || header.copyTableCount > 0)) {
					data.seek(section.stringBlockOfs + header.stringTableSize);
					isZeroed = data.readUInt32LE() === 0;
				}

				// check if first entry in offsetMap has size 0
				if (isZeroed && (wdcVersion > 2) && header.offsetMapIDCount > 0)
					isZeroed = offsetMap[0].size === 0;

				if (isZeroed) {
					log.write('Skipping all-zero encrypted section ' + sectionIndex + ' in file ' + this.fileName);
					section.isEncrypted = true;
					continue;
				}
			}

			this.totalRecordCount += header.recordCount;
		}

		log.write('Parsed %s with %d rows', this.fileName, this.size);
		this.isLoaded = true;
	}

	/**
	 * Lazy-read string from string table by offset
	 * @param {number} stringTableIndex
	 * @returns {string}
	 */
	_readString(stringTableIndex) {
		// find which section contains this string table index
		let targetSection = null;
		for (let i = 0; i < this.sections.length; i++) {
			const sec = this.sections[i];
			const localOfs = stringTableIndex - sec.stringTableOffsetBase;
			if (localOfs >= 0 && localOfs < sec.header.stringTableSize) {
				targetSection = sec;
				break;
			}
		}

		if (!targetSection)
			throw new Error('String table index out of range');

		const localOffset = stringTableIndex - targetSection.stringTableOffsetBase;
		this.data.seek(targetSection.stringTableOffset + localOffset);
		return this.data.readString(this.data.indexOf(0x0) - this.data.offset, 'utf8');
	}

	/**
	 * Find which section contains a record ID
	 * @param {number} recordID
	 * @returns {object|null}
	 */
	_findSectionForRecord(recordID) {
		for (let sectionIndex = 0; sectionIndex < this.sections.length; sectionIndex++) {
			const section = this.sections[sectionIndex];
			if (section.isEncrypted)
				continue;

			const hasIDMap = section.idList.length > 0;
			const emptyIDMap = hasIDMap && section.idList.every(id => id === 0);

			if (hasIDMap && !emptyIDMap) {
				const recordIndex = section.idList.indexOf(recordID);
				if (recordIndex !== -1)
					return { sectionIndex, recordIndex, recordID };
			} else if (emptyIDMap) {
				// for empty id maps, recordID equals recordIndex
				if (recordID < section.header.recordCount)
					return { sectionIndex, recordIndex: recordID, recordID };
			} else {
				// no id map - need to scan records for inline id field
				for (let recordIndex = 0; recordIndex < section.header.recordCount; recordIndex++) {
					const record = this._readRecordFromSection(sectionIndex, recordIndex, undefined);
					if (record !== null && record[this.idField] === recordID)
						return { sectionIndex, recordIndex, recordID };
				}
			}
		}

		return null;
	}

	/**
	 * Read a record by ID
	 * @param {number} recordID
	 * @returns {object|null}
	 */
	_readRecord(recordID) {
		const location = this._findSectionForRecord(recordID);
		if (!location)
			return null;

		return this._readRecordFromSection(location.sectionIndex, location.recordIndex, recordID);
	}

	/**
	 * Read a specific record from a section
	 * @param {number} sectionIndex
	 * @param {number} recordIndex
	 * @param {number} recordID
	 * @returns {object|null}
	 */
	_readRecordFromSection(sectionIndex, recordIndex, recordID) {
		const section = this.sections[sectionIndex];
		const header = section.header;
		const offsetMap = section.offsetMap;
		const isNormal = section.isNormal;

		if (section.isEncrypted)
			return null;

		// total recordDataSize of all forward sections
		let outsideDataSize = 0;
		for (let i = 0; i < sectionIndex; i++)
			outsideDataSize += this.sections[i].recordDataSize;

		const hasIDMap = section.idList.length > 0;
		const emptyIDMap = hasIDMap && section.idList.every(id => id === 0);

		if (hasIDMap && emptyIDMap)
			recordID = recordIndex;

		// for variable-length records, we need recordID to look up offset
		const recordOfs = isNormal ? (recordIndex * this.recordSize) : offsetMap[this.wdcVersion === 2 ? recordID : recordIndex].offset;
		const absoluteRecordOffs = recordOfs - (this.recordCount * this.recordSize);

		if (!isNormal)
			this.data.seek(recordOfs);
		else
			this.data.seek(section.recordDataOfs + recordOfs);

		const out = {};
		let fieldIndex = 0;
		for (const [prop, type] of this.schema.entries()) {
			if (type === FieldType.Relation) {
				if (section.relationshipMap && section.relationshipMap.has(recordIndex))
					out[prop] = section.relationshipMap.get(recordIndex);
				else
					out[prop] = 0;

				continue;
			}

			if (type === FieldType.NonInlineID) {
				if (hasIDMap)
					out[prop] = section.idList[recordIndex];

				continue;
			}

			const recordFieldInfo = this.fieldInfo[fieldIndex];

			let count;
			let fieldType = type;
			if (Array.isArray(type))
				[fieldType, count] = type;

			const fieldOffsetBytes = Math.floor(recordFieldInfo.fieldOffsetBits / 8);

			switch (recordFieldInfo.fieldCompression) {
				case CompressionType.None:
					switch (fieldType) {
						case FieldType.String:
							if (isNormal) {
								// for WDC3+, strings are in string table
								if (this.wdcVersion > 2) {
									if (count > 0) {
										out[prop] = new Array(count);
										for (let stringArrayIndex = 0; stringArrayIndex < count; stringArrayIndex++) {
											const dataPos = (recordFieldInfo.fieldOffsetBits + (stringArrayIndex * (recordFieldInfo.fieldSizeBits / count))) >> 3;
											const ofsPos = this.data.offset;
											const ofs = this.data.readUInt32LE();

											if (ofs == 0) {
												out[prop][stringArrayIndex] = '';
											} else {
												// string table reference
												const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

												if (stringTableIndex == 0)
													out[prop][stringArrayIndex] = '';
												else
													out[prop][stringArrayIndex] = this._readString(stringTableIndex);
											}

											// ensure we're positioned at the next field
											this.data.seek(ofsPos + 4);
										}
									} else {
										const dataPos = recordFieldInfo.fieldOffsetBits >> 3;
										const ofsPos = this.data.offset;
										const ofs = this.data.readUInt32LE();

										if (ofs == 0) {
											out[prop] = '';
										} else {
											// string table reference
											const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

											if (stringTableIndex == 0)
												out[prop] = '';
											else
												out[prop] = this._readString(stringTableIndex);
										}

										// ensure we're positioned at the next field
										this.data.seek(ofsPos + 4);
									}
								} else {
									// for WDC2, strings are inline in record data
									if (count > 0) {
										out[prop] = new Array(count);
										for (let stringArrayIndex = 0; stringArrayIndex < count; stringArrayIndex++) {
											out[prop][stringArrayIndex] = this.data.readString(this.data.indexOf(0x0) - this.data.offset, 'utf8');
											this.data.readInt8(); // read NUL character
										}
									} else {
										out[prop] = this.data.readString(this.data.indexOf(0x0) - this.data.offset, 'utf8');
										this.data.readInt8(); // read NUL character
									}
								}
							} else {
								// sparse/offset records always have inline strings
								if (count > 0) {
									out[prop] = new Array(count);
									for (let stringArrayIndex = 0; stringArrayIndex < count; stringArrayIndex++) {
										out[prop][stringArrayIndex] = this.data.readString(this.data.indexOf(0x0) - this.data.offset, 'utf8');
										this.data.readInt8(); // read NUL character
									}
								} else {
									out[prop] = this.data.readString(this.data.indexOf(0x0) - this.data.offset, 'utf8');
									this.data.readInt8(); // read NUL character
								}
							}
							break;

						case FieldType.Int8: out[prop] = this.data.readInt8(count); break;
						case FieldType.UInt8: out[prop] = this.data.readUInt8(count); break;
						case FieldType.Int16: out[prop] = this.data.readInt16LE(count); break;
						case FieldType.UInt16: out[prop] = this.data.readUInt16LE(count); break;
						case FieldType.Int32: out[prop] = this.data.readInt32LE(count); break;
						case FieldType.UInt32: out[prop] = this.data.readUInt32LE(count); break;
						case FieldType.Int64: out[prop] = this.data.readInt64LE(count); break;
						case FieldType.UInt64: out[prop] = this.data.readUInt64LE(count); break;
						case FieldType.Float: out[prop] = this.data.readFloatLE(count); break;
					}
					break;

				case CompressionType.CommonData:
					if (this.commonData[fieldIndex].has(recordID))
						out[prop] = this.commonData[fieldIndex].get(recordID);
					else
						out[prop] = recordFieldInfo.fieldCompressionPacking[0]; // default value
					break;

				case CompressionType.Bitpacked:
				case CompressionType.BitpackedSigned:
				case CompressionType.BitpackedIndexed:
				case CompressionType.BitpackedIndexedArray: {
					this.data.seek(section.recordDataOfs + recordOfs + fieldOffsetBytes);

					let rawValue;
					if (this.data.remainingBytes >= 8) {
						rawValue = this.data.readUInt64LE();
					} else {
						this.castBuffer.seek(0);
						this.castBuffer.writeBuffer(this.data);
						this.castBuffer.seek(0);
						rawValue = this.castBuffer.readUInt64LE();
					}

					const bitOffset = BigInt(recordFieldInfo.fieldOffsetBits & 7);
					const bitSize = 1n << BigInt(recordFieldInfo.fieldSizeBits);
					const bitpackedValue = (rawValue >> bitOffset) & (bitSize - BigInt(1));

					if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
						out[prop] = new Array(recordFieldInfo.fieldCompressionPacking[2]);
						for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++)
							out[prop][i] = this.palletData[fieldIndex][(bitpackedValue * BigInt(recordFieldInfo.fieldCompressionPacking[2])) + BigInt(i)];
					} else if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexed) {
						if (bitpackedValue in this.palletData[fieldIndex])
							out[prop] = this.palletData[fieldIndex][bitpackedValue];
						else
							throw new Error('Encountered missing pallet data entry for key ' + bitpackedValue + ', field ' + fieldIndex);
					} else {
						out[prop] = bitpackedValue;
					}

					if (recordFieldInfo.fieldCompression == CompressionType.BitpackedSigned)
						out[prop] = BigInt(BigInt.asIntN(recordFieldInfo.fieldSizeBits, bitpackedValue));

					break;
				}
			}

			// reinterpret field correctly for compression types other than None
			if (recordFieldInfo.fieldCompression !== CompressionType.None) {
				if (!Array.isArray(type)) {
					this.castBuffer.seek(0);
					if (out[prop] < 0)
						this.castBuffer.writeBigInt64LE(BigInt(out[prop]));
					else
						this.castBuffer.writeBigUInt64LE(BigInt(out[prop]));

					this.castBuffer.seek(0);
					switch (fieldType) {
						case FieldType.String:
							throw new Error('Compressed string arrays currently not used/supported.');

						case FieldType.Int8: out[prop] = this.castBuffer.readInt8(); break;
						case FieldType.UInt8: out[prop] = this.castBuffer.readUInt8(); break;
						case FieldType.Int16: out[prop] = this.castBuffer.readInt16LE(); break;
						case FieldType.UInt16: out[prop] = this.castBuffer.readUInt16LE(); break;
						case FieldType.Int32: out[prop] = this.castBuffer.readInt32LE(); break;
						case FieldType.UInt32: out[prop] = this.castBuffer.readUInt32LE(); break;
						case FieldType.Int64: out[prop] = this.castBuffer.readInt64LE(); break;
						case FieldType.UInt64: out[prop] = this.castBuffer.readUInt64LE(); break;
						case FieldType.Float: out[prop] = this.castBuffer.readFloatLE(); break;
					}
				} else {
					for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++) {
						this.castBuffer.seek(0);
						if (out[prop] < 0)
							this.castBuffer.writeBigInt64LE(BigInt(out[prop][i]));
						else
							this.castBuffer.writeBigUInt64LE(BigInt(out[prop][i]));

						this.castBuffer.seek(0);
						switch (fieldType) {
							case FieldType.String:
								throw new Error('Compressed string arrays currently not used/supported.');

							case FieldType.Int8: out[prop][i] = this.castBuffer.readInt8(); break;
							case FieldType.UInt8: out[prop][i] = this.castBuffer.readUInt8(); break;
							case FieldType.Int16: out[prop][i] = this.castBuffer.readInt16LE(); break;
							case FieldType.UInt16: out[prop][i] = this.castBuffer.readUInt16LE(); break;
							case FieldType.Int32: out[prop][i] = this.castBuffer.readInt32LE(); break;
							case FieldType.UInt32: out[prop][i] = this.castBuffer.readUInt32LE(); break;
							case FieldType.Int64: out[prop][i] = this.castBuffer.readInt64LE(); break;
							case FieldType.UInt64: out[prop][i] = this.castBuffer.readUInt64LE(); break;
							case FieldType.Float: out[prop][i] = this.castBuffer.readFloatLE(); break;
						}
					}
				}
			}

			if (!hasIDMap && fieldIndex === this.idFieldIndex) {
				recordID = out[prop];
				this.idField = prop;
			}

			fieldIndex++;
		}

		// populate relationship lookup when first reading
		if (section.relationshipMap && section.relationshipMap.has(recordIndex)) {
			const foreignID = section.relationshipMap.get(recordIndex);
			const lookup = this.relationshipLookup.get(foreignID);
			if (lookup && !lookup.includes(recordID))
				lookup.push(recordID);
		}

		return out;
	}
}

module.exports = WDCReader;