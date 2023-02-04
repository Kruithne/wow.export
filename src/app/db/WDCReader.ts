/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';

import Log from '../log';
import State from '../state';
import Constants from '../constants';
import { downloadFile } from '../generics';

import ExportHelper from '../casc/export-helper';
import { DBDParser, DBDField, DBDEntry } from './DBDParser';
import BufferWrapper from '../buffer';

const TABLE_FORMATS = {
	0x32434457: { name: 'WDC2', wdcVersion: 2 },
	0x434C5331: { name: 'CLS1', wdcVersion: 2 },
	0x33434457: { name: 'WDC3', wdcVersion: 3 }
};

enum CompressionType {
	None,
	Bitpacked,
	CommonData,
	BitpackedIndexed,
	BitpackedIndexedArray,
	BitpackedSigned
}

enum FieldType {
	String,
	Int8,
	UInt8,
	Int16,
	UInt16,
	Int32,
	UInt32,
	Int64,
	UInt64,
	Float,
	Relation,
	NonInlineID
}

type DataTableValue = string | number | bigint;
interface DataTableRow {
	[key: string]: DataTableValue | Array<DataTableValue>;
}

/**
 * Returns the schema type symbol for a DBD field.
 * @param entry
 * @returns Field type
 */

const convertDBDToSchemaType = (entry: DBDField): FieldType => {
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
export default class WDCReader {
	fileName: string;
	rows: Map<number, DataTableRow> = new Map();
	copyTable: Map<number, number> = new Map();
	stringTable: Map<number, string> = new Map();
	schema: Map<string, object | FieldType> = new Map();
	isInflated = false;
	isLoaded = false;
	idField: string;
	idFieldIndex: number;

	/**
	 * Construct a new WDCReader instance.
	 * @param fileName - The name of the file to read.
	 */
	constructor(fileName: string) {
		this.fileName = fileName;
	}

	/**
	 * Returns the amount of rows available in the table.
	 */
	get size(): number {
		return this.rows.size + this.copyTable.size;
	}

	/**
	 * Get a row from this table.
	 * Returns NULL if the row does not exist.
	 * @param number - recordID
	 */
	getRow(recordID: number): DataTableRow | null {
		// The table needs to be loaded before we attempt to access a row.
		// We could just return a NULL here, but throwing an error highlights the mistake.
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table row before table was loaded.');

		// Look this row up as a normal entry.
		const record = this.rows.get(recordID);
		if (record !== undefined)
			return record;

		// Check if the copy table contains a mapping entry.
		const copyID = this.copyTable.get(recordID);
		if (copyID !== undefined) {
			const copy = this.rows.get(copyID);
			if (copy !== undefined) {
				const tempCopy = Object.assign({}, copy);
				tempCopy['ID'] = recordID;
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
	getAllRows(): Map<number, DataTableRow> {
		// The table needs to be loaded before we attempt to access the rows.
		// We could just return an empty Map here, but throwing an error highlights the mistake.
		if (!this.isLoaded)
			throw new Error('Attempted to read a data table rows before table was loaded.');

		const rows = this.rows;

		// Inflate all copy table data before returning.
		if (!this.isInflated) {
			for (const [destID, srcID] of this.copyTable) {
				const rowData = Object.assign({}, rows.get(srcID));
				rowData['ID'] = destID;
				rows.set(destID, rowData);
			}

			this.isInflated = true;
		}

		return rows;
	}

	/**
	 * Load the schema for this table.
	 * @param layoutHash - The layout hash of the table.
	 */
	async loadSchema(layoutHash: string): Promise<void> {
		const casc = State.state.casc;
		const buildID = casc.getBuildName();

		const tableName = ExportHelper.replaceExtension(path.basename(this.fileName));
		const dbdName = tableName + '.dbd';

		let structure: DBDEntry | null = null;
		Log.write('Loading table definitions %s (%s %s)...', dbdName, buildID, layoutHash);

		// First check if a valid DBD exists in cache and contains a definition for this build.
		let rawDbd = await casc.cache.getFile(dbdName, Constants.CACHE.DIR_DBD);
		if (rawDbd !== null)
			structure = new DBDParser(rawDbd).getStructure(buildID, layoutHash);

		// No cached definition, download updated DBD and check again.
		if (structure === null) {
			try {
				const dbdUrl = util.format(State.state.config.dbdURL, tableName);
				Log.write('No cached DBD, downloading new from %s', dbdUrl);

				rawDbd = await downloadFile(dbdUrl);

				// Persist the newly download DBD to disk for future loads.
				await casc.cache.storeFile(dbdName, rawDbd, Constants.CACHE.DIR_DBD);

				// Parse the updated DBD and check for definition.
				structure = new DBDParser(rawDbd).getStructure(buildID, layoutHash);
			} catch (e) {
				Log.write(e);
				throw new Error('Unable to download DBD for ' + tableName);
			}
		}

		if (structure === null)
			throw new Error('No table definition available for ' + tableName);

		this.buildSchemaFromDBDStructure(structure);
	}

	/**
	 * Builds a schema for this data table using the provided DBD structure.
	 * @param structure
	 */
	buildSchemaFromDBDStructure(structure: DBDEntry): void {
		for (const field of structure.fields) {
			const fieldType = convertDBDToSchemaType(field);
			if (field.arrayLength > -1)
				this.schema.set(field.name, [fieldType, field.arrayLength]);
			else
				this.schema.set(field.name, fieldType); // NIT: Improve typing.
		}
	}

	/**
	 * Gets index of ID field
	 */
	getIDIndex(): number {
		if (!this.isLoaded)
			throw new Error('Attempted to get ID index before table was loaded.');

		return this.idFieldIndex;
	}

	/**
	 * Parse the data table.
	 */
	async parse(): Promise<void> {
		Log.write('Loading DB file %s from CASC', this.fileName);

		const data: BufferWrapper = await State.state.casc.getFileByName(this.fileName, true, false, true);

		// wdc_magic
		const magic = data.readUInt32();
		const format = TABLE_FORMATS[magic];

		if (!format)
			throw new Error('Unsupported DB2 type: ' + magic);

		const wdcVersion = format.wdcVersion;
		Log.write('Processing DB file %s as %s', this.fileName, format.name);

		// wdc_db2_header
		const recordCount = data.readUInt32();
		data.move(4); // fieldCount
		const recordSize = data.readUInt32();
		data.move(4); // stringTableSize
		data.move(4); // tableHash
		const layoutHash = data.readUInt8Array(4).reverse().map(e => e.toString(16).padStart(2, '0')).join('').toUpperCase();
		const minID = data.readUInt32();
		const maxID = data.readUInt32();
		data.move(4); // locale
		const flags = data.readUInt16();
		const idIndex = data.readUInt16();
		this.idFieldIndex = idIndex;
		const totalFieldCount = data.readUInt32();
		data.move(4); // bitpackedDataOffset
		data.move(4); // lookupColumnCount
		const fieldStorageInfoSize = data.readUInt32();
		const commonDataSize = data.readUInt32();
		const palletDataSize = data.readUInt32();
		const sectionCount = data.readUInt32();

		// Load the DBD and parse a schema from it.
		await this.loadSchema(layoutHash);

		// wdc_section_header section_headers[section_count]
		const sectionHeaders = new Array(sectionCount);
		for (let i = 0; i < sectionCount; i++) {
			sectionHeaders[i] = wdcVersion === 2 ? {
				tactKeyHash: data.readUInt64(),
				fileOffset: data.readUInt32(),
				recordCount: data.readUInt32(),
				stringTableSize: data.readUInt32(),
				copyTableSize: data.readUInt32(),
				offsetMapOffset: data.readUInt32(),
				idListSize: data.readUInt32(),
				relationshipDataSize: data.readUInt32()
			} : {
				tactKeyHash: data.readUInt64(),
				fileOffset: data.readUInt32(),
				recordCount: data.readUInt32(),
				stringTableSize: data.readUInt32(),
				offsetRecordsEnd: data.readUInt32(),
				idListSize: data.readUInt32(),
				relationshipDataSize: data.readUInt32(),
				offsetMapIDCount: data.readUInt32(),
				copyTableCount: data.readUInt32()
			};
		}

		// fields[header.total_field_count]
		const fields = new Array(totalFieldCount);
		for (let i = 0; i < totalFieldCount; i++)
			fields[i] = { size: data.readInt16(), position: data.readUInt16() };

		// field_info[header.field_storage_info_size / sizeof(field_storage_info)]
		const fieldInfo = new Array(fieldStorageInfoSize / (4 * 6));
		for (let i = 0, n = fieldInfo.length; i < n; i++) {
			fieldInfo[i] = {
				fieldOffsetBits: data.readUInt16(),
				fieldSizeBits: data.readUInt16(),
				additionalDataSize: data.readUInt32(),
				fieldCompression: data.readUInt32(),
				fieldCompressionPacking: data.readUInt32Array(3)
			};
		}

		// char pallet_data[header.pallet_data_size];
		let prevPos = data.offset;

		const palletData = new Array(fieldInfo.length);
		for (let fieldIndex = 0, nFields = fieldInfo.length; fieldIndex < nFields; fieldIndex++) {
			const thisFieldInfo = fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexed || thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
				palletData[fieldIndex] = [];
				for (let i = 0; i < thisFieldInfo.additionalDataSize / 4; i++)
					palletData[fieldIndex][i] = data.readUInt32();
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
					commonDataMap.set(data.readUInt32(), data.readUInt32());
			}
		}

		// Ensure we've read the expected amount of common data.
		assert.strictEqual(data.offset, prevPos + commonDataSize, 'Read incorrect amount of common data');

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
					offsetMap[minID + i] = { offset: data.readUInt32(), size: data.readUInt16() };
			}

			if (wdcVersion === 3 && isNormal) {
				data.seek(stringBlockOfs);
				for (let i = 0; i < header.stringTableSize;) {
					const oldPos = data.offset;
					const stringResult = data.readString(data.indexOf(0x0) - data.offset, 'utf8');

					if (stringResult != '')
						stringTable.set(i + previousStringTableSize, stringResult);

					if (data.offset == oldPos)
						data.seek(oldPos + 1);

					i += (data.offset - oldPos);
				}

				previousStringTableSize += header.stringTableSize;
			}

			data.seek(stringBlockOfs + header.stringTableSize);

			// uint32_t id_list[section_headers.id_list_size / 4];
			const idList = data.readUInt32Array(header.idListSize / 4);

			// copy_table_entry copy_table[section_headers.copy_table_count];
			const copyTableCount = wdcVersion === 2 ? (header.copyTableSize / 8) : header.copyTableCount;
			for (let i = 0; i < copyTableCount; i++) {
				const destinationRowID = data.readInt32();
				const sourceRowID = data.readInt32();
				if (destinationRowID != sourceRowID)
					copyTable.set(destinationRowID, sourceRowID);
			}

			if (wdcVersion === 3) {
				// offset_map_entry offset_map[section_headers.offset_map_id_count];
				offsetMap = new Array(header.offsetMapIDCount);
				for (let i = 0, n = header.offsetMapIDCount; i < n; i++)
					offsetMap[i] = { offset: data.readUInt32(), size: data.readUInt16() };
			}

			prevPos = data.offset;

			// relationship_map
			let relationshipMap;

			if (header.relationshipDataSize > 0) {
				const relationshipEntryCount = data.readUInt32();
				data.move(8); // relationshipMinID (UInt32) and relationshipMaxID (UInt32)

				relationshipMap = new Map();
				for (let i = 0; i < relationshipEntryCount; i++) {
					const foreignID = data.readUInt32();
					const recordIndex = data.readUInt32();
					relationshipMap.set(recordIndex, foreignID);
				}

				// If a section is encrypted it is highly likely we don't read the correct amount of data here. Skip ahead if so.
				if (prevPos + header.relationshipDataSize != data.offset)
					data.seek(prevPos + header.relationshipDataSize);
			}

			// uint32_t offset_map_id_list[section_headers.offset_map_id_count];
			// Duplicate of id_list for sections with offset records.
			// TODO: Read
			if (wdcVersion === 3)
				data.move(header.offsetMapIDCount * 4);

			sections[sectionIndex] = { header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, idList, offsetMap, relationshipMap };
		}

		const castBuffer = new BufferWrapper(Buffer.alloc(8));

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
				if (isZeroed && wdcVersion === 3 && isNormal && (header.idListSize > 0 || header.copyTableCount > 0)) {
					data.seek(section.stringBlockOfs + header.stringTableSize);
					isZeroed = data.readUInt32() === 0;
				}

				// Check if first entry in offsetMap has size 0
				if (isZeroed && wdcVersion === 3 && header.offsetMapIDCount > 0)
					isZeroed = offsetMap[0].size === 0;

				if (isZeroed) {
					Log.write('Skipping all-zero encrypted section ' + sectionIndex + ' in file ' + this.fileName);
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

				const out: DataTableRow = {};
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

					let count: number;
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
												const ofs = data.readUInt32();

												const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

												if (ofs == 0 || stringTableIndex == 0) {
													out[prop][stringArrayIndex] = '';
												} else {
													if (stringTable.has(stringTableIndex))
														out[prop][stringArrayIndex] = stringTable.get(stringTableIndex);
													else
														throw new Error('Missing stringtable entry');
												}
											}
										} else {
											const dataPos = recordFieldInfo.fieldOffsetBits >> 3;
											const ofs = data.readUInt32();

											const stringTableIndex = outsideDataSize + absoluteRecordOffs + dataPos + ofs;

											if (ofs == 0 || stringTableIndex == 0) {
												out[prop] = '';
											} else {
												const value = stringTable.get(stringTableIndex);
												if (value === undefined)
													throw new Error('Missing stringtable entry');

												out[prop] = value;
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

								case FieldType.Int8: out[prop] = data.readInt8Array(count); break;
								case FieldType.UInt8: out[prop] = data.readUInt8Array(count); break;
								case FieldType.Int16: out[prop] = data.readInt16Array(count); break;
								case FieldType.UInt16: out[prop] = data.readUInt16Array(count); break;
								case FieldType.Int32: out[prop] = data.readInt32Array(count); break;
								case FieldType.UInt32: out[prop] = data.readUInt32Array(count); break;
								case FieldType.Int64: out[prop] = data.readInt64Array(count); break;
								case FieldType.UInt64: out[prop] = data.readUInt64Array(count); break;
								case FieldType.Float: out[prop] = data.readFloatArray(count); break;
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
								rawValue = data.readUInt64();
							} else {
								castBuffer.seek(0);
								castBuffer.writeBuffer(data.buffer, data.offset);

								castBuffer.seek(0);
								rawValue = castBuffer.readUInt64();
							}

							// Read bitpacked value, in the case BitpackedIndex(Array) this is an index into palletData.

							// Get the remaining amount of bits that remain (we read to the nearest byte)
							const bitOffset = BigInt(recordFieldInfo.fieldOffsetBits & 7);
							const bitSize = 1n << BigInt(recordFieldInfo.fieldSizeBits);
							const bitpackedValue = (rawValue >> bitOffset) & (bitSize - BigInt(1));

							if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
								out[prop] = new Array(recordFieldInfo.fieldCompressionPacking[2]);
								for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++) {
									const bitpackedIndexKey = (bitpackedValue * BigInt(recordFieldInfo.fieldCompressionPacking[2])) + BigInt(i);
									out[prop][i] = palletData[fieldIndex][Number(bitpackedIndexKey)];
								}
							} else if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexed) {
								if (Number(bitpackedValue) in palletData[fieldIndex])
									out[prop] = palletData[fieldIndex][Number(bitpackedValue)];
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
								castBuffer.writeInt64(BigInt(out[prop] as number));
							else
								castBuffer.writeUInt64(BigInt(out[prop] as number));

							castBuffer.seek(0);
							switch (fieldType) {
								case FieldType.String:
									throw new Error('Compressed string arrays currently not used/supported.');

								case FieldType.Int8: out[prop] = castBuffer.readInt8(); break;
								case FieldType.UInt8: out[prop] = castBuffer.readUInt8(); break;
								case FieldType.Int16: out[prop] = castBuffer.readInt16(); break;
								case FieldType.UInt16: out[prop] = castBuffer.readUInt16(); break;
								case FieldType.Int32: out[prop] = castBuffer.readInt32(); break;
								case FieldType.UInt32: out[prop] = castBuffer.readUInt32(); break;
								case FieldType.Int64: out[prop] = castBuffer.readInt64(); break;
								case FieldType.UInt64: out[prop] = castBuffer.readUInt64(); break;
								case FieldType.Float: out[prop] = castBuffer.readFloat(); break;
							}
						} else {
							for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++) {
								castBuffer.seek(0);
								if (out[prop] < 0)
									castBuffer.writeInt64(BigInt(out[prop][i]));
								else
									castBuffer.writeUInt64(BigInt(out[prop][i]));

								castBuffer.seek(0);
								switch (fieldType) {
									case FieldType.String:
										throw new Error('Compressed string arrays currently not used/supported.');

									case FieldType.Int8: out[prop][i] = castBuffer.readInt8(); break;
									case FieldType.UInt8: out[prop][i] = castBuffer.readUInt8(); break;
									case FieldType.Int16: out[prop][i] = castBuffer.readInt16(); break;
									case FieldType.UInt16: out[prop][i] = castBuffer.readUInt16(); break;
									case FieldType.Int32: out[prop][i] = castBuffer.readInt32(); break;
									case FieldType.UInt32: out[prop][i] = castBuffer.readUInt32(); break;
									case FieldType.Int64: out[prop][i] = castBuffer.readInt64(); break;
									case FieldType.UInt64: out[prop][i] = castBuffer.readUInt64(); break;
									case FieldType.Float: out[prop][i] = castBuffer.readFloat(); break;
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
							out[prop] = Math.round(Number(out[prop]) * 100) / 100;
						}
					}

					if (!hasIDMap && fieldIndex === idIndex) {
						recordID = out[prop];
						this.idField = prop;
					}

					fieldIndex++;
				}

				this.rows.set(recordID, out);
			}
		}

		Log.write('Parsed %s with %d rows', this.fileName, this.size);
		this.isLoaded = true;
	}
}