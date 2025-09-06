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

		this.rows = new Map();
		this.copyTable = new Map();
		this.stringTable = new Map();

		this.schema = new Map();

		this.isInflated = false;
		this.isLoaded = false;
		this.idField = null;
		this.idFieldIndex = null;
		
		this.relationshipLookup = new Map();
	}

	/**
	 * Returns the amount of rows available in the table.
	 */
	get size() {
		return this.rows.size + this.copyTable.size;
	}
	
	/**
	 * Get a row from this table.
	 * Returns NULL if the row does not exist.
	 * @param {number} recordID 
	 */
	getRow(recordID) {
		// The table needs to be loaded before we attempt to access a row.
		// We could just return a NULL here, but throwing an error highlights the mistake.
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table row before table was loaded.');

		// Ensure incoming recordID is always an integer
		recordID = parseInt(recordID);

		// Look this row up as a normal entry.
		const record = this.rows.get(recordID);
		if (record !== undefined)
			return record;

		// Check if the copy table contains a mapping entry.
		const copyID = this.copyTable.get(recordID);
		if (copyID !== undefined) {
			const copy = this.rows.get(copyID);
			if (copy !== undefined) {
				let tempCopy = Object.assign({}, copy);
				tempCopy.ID = recordID;
				return tempCopy;
			}
		}

		// Row does not exist.
		return null;
	}

	/**
	 * Returns all available rows in the table.
	 * Calling this will permanently inflate internal copy data; use wisely.
	 */
	getAllRows() {
		// The table needs to be loaded before we attempt to access the rows.
		// We could just return an empty Map here, but throwing an error highlights the mistake.
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table rows before table was loaded.');

		const rows = this.rows;

		// Inflate all copy table data before returning.
		if (!this.isInflated) {
			for (const [destID, srcID] of this.copyTable) {
				let rowData = Object.assign({}, rows.get(srcID));
				rowData.ID = destID;
				rows.set(destID, rowData);
			}

			this.isInflated = true;
		}

		return rows;
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
			const row = this.rows.get(recordID);
			if (row !== undefined)
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

		// First check if a valid DBD exists in cache and contains a definition for this build.
		let rawDbd = await casc.cache.getFile(dbdName, constants.CACHE.DIR_DBD);
		if (rawDbd !== null)
			structure = new DBDParser(rawDbd).getStructure(buildID, layoutHash);

		// No cached definition, download updated DBD and check again.
		if (structure === null) {
			const dbd_url = util.format(core.view.config.dbdURL, tableName);
			const dbd_url_fallback = util.format(core.view.config.dbdFallbackURL, tableName);

			try {
				log.write(`No cached DBD, downloading new from ${dbd_url}`);
				rawDbd = await generics.downloadFile([dbd_url, dbd_url_fallback]);

				// Persist the newly download DBD to disk for future loads.
				await casc.cache.storeFile(dbdName, rawDbd, constants.CACHE.DIR_DBD);

				// Parse the updated DBD and check for definition.
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

	/**
	 * Parse the data table.
	 * @param {object} [data] 
	 */
	async parse(data) {
		log.write('Loading DB file %s from CASC', this.fileName);

		if (!data)
			data = await core.view.casc.getFileByName(this.fileName, true, false, true);

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
		const recordCount = data.readUInt32LE();
		data.move(4); // fieldCount
		const recordSize = data.readUInt32LE();
		data.move(4); // stringTableSize
		data.move(4); // tableHash
		const layoutHash = data.readUInt8(4).reverse().map(e => e.toString(16).padStart(2, '0')).join('').toUpperCase();
		const minID = data.readUInt32LE();
		const maxID = data.readUInt32LE();
		data.move(4); // locale
		const flags = data.readUInt16LE();
		const idIndex = data.readUInt16LE();
		this.idFieldIndex = idIndex;
		const totalFieldCount = data.readUInt32LE();
		data.move(4); // bitpackedDataOffset
		data.move(4); // lookupColumnCount
		const fieldStorageInfoSize = data.readUInt32LE();
		const commonDataSize = data.readUInt32LE();
		const palletDataSize = data.readUInt32LE();
		const sectionCount = data.readUInt32LE();

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
		const fieldInfo = new Array(fieldStorageInfoSize / (4 * 6));
		for (let i = 0, n = fieldInfo.length; i < n; i++) {
			fieldInfo[i] = {
				fieldOffsetBits: data.readUInt16LE(),
				fieldSizeBits: data.readUInt16LE(),
				additionalDataSize: data.readUInt32LE(),
				fieldCompression: data.readUInt32LE(),
				fieldCompressionPacking: data.readUInt32LE(3)
			};
		}

		// char pallet_data[header.pallet_data_size];
		let prevPos = data.offset;

		const palletData = new Array(fieldInfo.length);
		for (let fieldIndex = 0, nFields = fieldInfo.length; fieldIndex < nFields; fieldIndex++) {
			const thisFieldInfo = fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexed || thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
				palletData[fieldIndex] = new Array();
				for (let i = 0; i < thisFieldInfo.additionalDataSize / 4; i++)
					palletData[fieldIndex][i] = data.readUInt32LE();
			}
		}

		// Ensure we've read the expected amount of pallet data.
		assert.strictEqual(data.offset, prevPos + palletDataSize, 'Read incorrect amount of pallet data');

		prevPos = data.offset;

		// char common_data[header.common_data_size];
		const commonData = new Array(fieldInfo.length);
		for (let fieldIndex = 0, nFields = fieldInfo.length; fieldIndex < nFields; fieldIndex++) {
			const thisFieldInfo = fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.CommonData) {
				const commonDataMap = commonData[fieldIndex] = new Map();

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
		const sections = new Array(sectionCount);
		const copyTable = this.copyTable;
		const stringTable = this.stringTable;
		let previousStringTableSize = 0;
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const header = sectionHeaders[sectionIndex];
			const isNormal = !(flags & 1);

			const recordDataOfs = data.offset;
			const recordsOfs = wdcVersion === 2 ? header.offsetMapOffset : header.offsetRecordsEnd;
			const recordDataSize = isNormal ? recordSize * header.recordCount : recordsOfs - header.fileOffset;
			const stringBlockOfs = recordDataOfs + recordDataSize;

			let offsetMap;
			if (wdcVersion === 2 && !isNormal) {
				data.seek(header.offsetMapOffset);
				// offset_map_entry offset_map[header.max_id - header.min_id + 1];
				const offsetMapCount = maxID - minID + 1;
				offsetMap = new Array(offsetMapCount);
				for (let i = 0, n = offsetMapCount; i < n; i++)
					offsetMap[minID + i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };
			}

			if ((wdcVersion > 2) && isNormal) {
				data.seek(stringBlockOfs);
				for (let i = 0; i < header.stringTableSize;)
				{
					const oldPos = data.offset;
					const stringResult = data.readString(data.indexOf(0x0) - data.offset, 'utf8');

					if (stringResult != "")
						stringTable.set(i + previousStringTableSize, stringResult);
					
					if (data.offset == oldPos)
						data.seek(oldPos + 1);

					i += (data.offset - oldPos);
				}

				previousStringTableSize += header.stringTableSize;
			}

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
				}

				// If a section is encrypted it is highly likely we don't read the correct amount of data here. Skip ahead if so.
				if (prevPos + header.relationshipDataSize != data.offset)
					data.seek(prevPos + header.relationshipDataSize);
			}

			// uint32_t offset_map_id_list[section_headers.offset_map_id_count];
			// Duplicate of id_list for sections with offset records.
			// TODO: Read
			if (wdcVersion > 2)
				data.move(header.offsetMapIDCount * 4);

			sections[sectionIndex] = { header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, idList, offsetMap, relationshipMap };
		}

		const castBuffer = BufferWrapper.alloc(8, true);

		// Parse section records.
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const section = sections[sectionIndex];
			const header = section.header;
			const offsetMap = section.offsetMap;
			const isNormal = section.isNormal;

			// Skip parsing entries from encrypted sections.
			if (header.tactKeyHash !== BigInt(0)) {
				let isZeroed = true;

				// Check if record data is all zeroes
				data.seek(section.recordDataOfs);
				for (let i = 0, n = section.recordDataSize; i < n; i++) {
					if (data.readUInt8() !== 0x0) {
						isZeroed = false;
						break;
					}
				}

				// Check if first integer after string block (from id list or copy table) is non-0
				if (isZeroed && (wdcVersion > 2) && isNormal && (header.idListSize > 0 || header.copyTableCount > 0)) {
					data.seek(section.stringBlockOfs + header.stringTableSize);
					isZeroed = data.readUInt32LE() === 0;
				}

				// Check if first entry in offsetMap has size 0
				if (isZeroed && (wdcVersion > 2) && header.offsetMapIDCount > 0) 
					isZeroed = offsetMap[0].size === 0;
				
				if (isZeroed) {
					log.write("Skipping all-zero encrypted section " + sectionIndex + " in file " + this.fileName);
					continue;
				}
			}

			// Total recordDataSize of all forward sections
			let outsideDataSize = 0;

			for (let i = 0; i < sectionCount; i++) {
				if (i < sectionIndex)
					outsideDataSize += sections[i].recordDataSize;
			}

			const hasIDMap = section.idList.length > 0;
			for (let i = 0, n = header.recordCount; i < n; i++) {
				let recordID;

				if (hasIDMap)
					recordID = section.idList[i];

				const recordOfs = isNormal ? (i * recordSize) : offsetMap[wdcVersion === 2 ? recordID : i].offset;

				const absoluteRecordOffs = recordOfs - (recordCount * recordSize);

				if (!isNormal) 
					data.seek(recordOfs);
				else 
					data.seek(section.recordDataOfs + recordOfs);
				
				const out = {};
				let fieldIndex = 0;
				for (const [prop, type] of this.schema.entries()) {
					if (type === FieldType.Relation) {
						if (section.relationshipMap.has(i)) 
							out[prop] = section.relationshipMap.get(i);
						else 
							out[prop] = 0;
						
						continue;
					}

					if (type === FieldType.NonInlineID) {
						if (hasIDMap)
							out[prop] = section.idList[i];

						continue;
					}

					const recordFieldInfo = fieldInfo[fieldIndex];

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
										if (count > 0) {
											out[prop] = new Array(count);
											for (let stringArrayIndex = 0; stringArrayIndex < count; stringArrayIndex++) {
												const dataPos = (recordFieldInfo.fieldOffsetBits + (stringArrayIndex * (recordFieldInfo.fieldSizeBits / count))) >> 3;
												const ofs = data.readUInt32LE();

												const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

												if (ofs == 0 || stringTableIndex == 0) {
													out[prop][stringArrayIndex] = "";
												} else {
													if (stringTable.has(stringTableIndex))
														out[prop][stringArrayIndex] = stringTable.get(stringTableIndex);
													else
														throw new Error('Missing stringtable entry');
												}
											}
										} else {
											const dataPos = recordFieldInfo.fieldOffsetBits >> 3;
											const ofs = data.readUInt32LE();

											const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

											if (ofs == 0 || stringTableIndex == 0) {
												out[prop] = "";
											} else {
												if (stringTable.has(stringTableIndex))
													out[prop] = stringTable.get(stringTableIndex);
												else
													throw new Error('Missing stringtable entry');
											}
										}
									} else {
										if (count > 0) {
											out[prop] = new Array(count);
											for (let stringArrayIndex = 0; stringArrayIndex < count; stringArrayIndex++) {
												out[prop][stringArrayIndex] = data.readString(data.indexOf(0x0) - data.offset, 'utf8');
												data.readInt8(); // Read NUL character
											}
										} else {
											out[prop] = data.readString(data.indexOf(0x0) - data.offset, 'utf8');
											data.readInt8(); // Read NUL character
										}
									}
									break;

								case FieldType.Int8: out[prop] = data.readInt8(count); break;
								case FieldType.UInt8: out[prop] = data.readUInt8(count); break;
								case FieldType.Int16: out[prop] = data.readInt16LE(count); break;
								case FieldType.UInt16: out[prop] = data.readUInt16LE(count); break;
								case FieldType.Int32: out[prop] = data.readInt32LE(count); break;
								case FieldType.UInt32: out[prop] = data.readUInt32LE(count); break;
								case FieldType.Int64: out[prop] = data.readInt64LE(count); break;
								case FieldType.UInt64: out[prop] = data.readUInt64LE(count); break;
								case FieldType.Float: out[prop] = data.readFloatLE(count); break;
							}
							break;
							
						case CompressionType.CommonData:
							if (commonData[fieldIndex].has(recordID))
								out[prop] = commonData[fieldIndex].get(recordID);
							else
								out[prop] = recordFieldInfo.fieldCompressionPacking[0]; // Default value
							break;

						case CompressionType.Bitpacked:
						case CompressionType.BitpackedSigned:
						case CompressionType.BitpackedIndexed:
						case CompressionType.BitpackedIndexedArray: {
							// TODO: All bitpacked stuff requires testing on more DB2s before being able to call it done.
							data.seek(section.recordDataOfs + recordOfs + fieldOffsetBytes);

							let rawValue;
							if (data.remainingBytes >= 8) {
								rawValue = data.readUInt64LE();
							} else {
								castBuffer.seek(0);
								castBuffer.writeBuffer(data);

								castBuffer.seek(0);
								rawValue = castBuffer.readUInt64LE();
							}

							// Read bitpacked value, in the case BitpackedIndex(Array) this is an index into palletData.

							// Get the remaining amount of bits that remain (we read to the nearest byte)
							const bitOffset = BigInt(recordFieldInfo.fieldOffsetBits & 7);
							const bitSize = 1n << BigInt(recordFieldInfo.fieldSizeBits);
							const bitpackedValue = (rawValue >> bitOffset) & (bitSize - BigInt(1));

							if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
								out[prop] = new Array(recordFieldInfo.fieldCompressionPacking[2]);
								for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++)
									out[prop][i] = palletData[fieldIndex][(bitpackedValue * BigInt(recordFieldInfo.fieldCompressionPacking[2])) + BigInt(i)];
							} else if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexed) {
								if (bitpackedValue in palletData[fieldIndex])
									out[prop] = palletData[fieldIndex][bitpackedValue];
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

					// Reinterpret field correctly for compression types other than None
					if (recordFieldInfo.fieldCompression !== CompressionType.None) {
						if (!Array.isArray(type)) {
							castBuffer.seek(0);
							if (out[prop] < 0) 
								castBuffer.writeBigInt64LE(BigInt(out[prop]));
							else 
								castBuffer.writeBigUInt64LE(BigInt(out[prop]));
							
							castBuffer.seek(0);
							switch (fieldType) {
								case FieldType.String:
									throw new Error('Compressed string arrays currently not used/supported.');

								case FieldType.Int8: out[prop] = castBuffer.readInt8(); break;
								case FieldType.UInt8: out[prop] = castBuffer.readUInt8(); break;
								case FieldType.Int16: out[prop] = castBuffer.readInt16LE(); break;
								case FieldType.UInt16: out[prop] = castBuffer.readUInt16LE(); break;
								case FieldType.Int32: out[prop] = castBuffer.readInt32LE(); break;
								case FieldType.UInt32: out[prop] = castBuffer.readUInt32LE(); break;
								case FieldType.Int64: out[prop] = castBuffer.readInt64LE(); break;
								case FieldType.UInt64: out[prop] = castBuffer.readUInt64LE(); break;
								case FieldType.Float: out[prop] = castBuffer.readFloatLE(); break;
							}
						} else {
							for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++) {
								castBuffer.seek(0);
								if (out[prop] < 0) 
									castBuffer.writeBigInt64LE(BigInt(out[prop][i]));
								else 
									castBuffer.writeBigUInt64LE(BigInt(out[prop][i]));
							
								castBuffer.seek(0);
								switch (fieldType) {
									case FieldType.String:
										throw new Error('Compressed string arrays currently not used/supported.');

									case FieldType.Int8: out[prop][i] = castBuffer.readInt8(); break;
									case FieldType.UInt8: out[prop][i] = castBuffer.readUInt8(); break;
									case FieldType.Int16: out[prop][i] = castBuffer.readInt16LE(); break;
									case FieldType.UInt16: out[prop][i] = castBuffer.readUInt16LE(); break;
									case FieldType.Int32: out[prop][i] = castBuffer.readInt32LE(); break;
									case FieldType.UInt32: out[prop][i] = castBuffer.readUInt32LE(); break;
									case FieldType.Int64: out[prop][i] = castBuffer.readInt64LE(); break;
									case FieldType.UInt64: out[prop][i] = castBuffer.readUInt64LE(); break;
									case FieldType.Float: out[prop][i] = castBuffer.readFloatLE(); break;
								}
							}
						}
					}

					// Round floats correctly
					if (fieldType == FieldType.Float) {
						if (count > 0) {
							for (let i = 0; i < count; i++)
								out[prop][i] = Math.round(out[prop][i] * 100) / 100;
						} else {
							out[prop] = Math.round(out[prop] * 100) / 100;
						}
					}

					if (!hasIDMap && fieldIndex === idIndex) {
						recordID = out[prop];
						this.idField = prop;
					}

					fieldIndex++;
				}

				this.rows.set(recordID, out);
				
				if (section.relationshipMap && section.relationshipMap.has(i)) {
					const foreignID = section.relationshipMap.get(i);
					if (!this.relationshipLookup.has(foreignID))
						this.relationshipLookup.set(foreignID, []);
					
					this.relationshipLookup.get(foreignID).push(recordID);
				}
			}
		}

		log.write('Parsed %s with %d rows', this.fileName, this.size);
		this.isLoaded = true;
	}
}

module.exports = WDCReader;