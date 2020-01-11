/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const assert = require('assert').strict;
const log = require('../log');
const core = require('../core');

const FieldType = require('./FieldType');
const CompressionType = require('./CompressionType');
const BufferWrapper = require('../buffer');

const TABLE_FORMATS = {
	0x32434457: { name: 'WDC2', wdcVersion: 2 },
	0x434C5331: { name: 'CLS1', wdcVersion: 2 },
	0x33434457: { name: 'WDC3', wdcVersion: 3 }
};

/**
 * Defines unified logic between WDC2 and WDC3.
 * @class WDC
 */
class WDCReader {
	/**
	 * Construct a new WDCReader instance.
	 * @param {string} fileName
	 * @param {object} schema 
	 */
	constructor(fileName, schema) {
		this.fileName = fileName;
		this.schema = schema;

		this.rows = new Map();
		this.copyTable = new Map();

		this.isInflated = false;
		this.isLoaded = false;
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

		// Look this row up as a normal entry.
		const record = this.rows.get(recordID);
		if (record !== undefined)
			return record;

		// Check if the copy table contains a mapping entry.
		const copyID = this.copyTable.get(recordID);
		if (copyID !== undefined) {
			const copy = this.rows.get(copyID);
			if (copy !== undefined)
				return copy;
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
			for (const [destID, srcID] of this.copyTable)
				rows.set(destID, rows.get(srcID));

			this.isInflated = true;
		}

		return rows;
	}

	/**
	 * Parse the data table.
	 * @param {object} [data] 
	 */
	async parse(data) {
		if (!data)
			data = await core.view.casc.getFileByName(this.fileName, true, false, true);

		// wdc_magic
		const magic = data.readUInt32LE();
		const format = TABLE_FORMATS[magic];

		if (!format)
			throw new Error('Unsupported DB2 type: ' + magic);

		const wdcVersion = format.wdcVersion;
		log.write('Processing DB file %s as %s', this.fileName, format.name);

		// wdc_db2_header
		const recordCount = data.readUInt32LE();
		const fieldCount = data.readUInt32LE();
		const recordSize = data.readUInt32LE();
		const stringTableSize = data.readUInt32LE();
		const tableHash = data.readUInt32LE();
		const layoutHash = data.readUInt32LE();
		const minID = data.readUInt32LE();
		const maxID = data.readUInt32LE();
		const locale = data.readUInt32LE();
		const flags = data.readUInt16LE();
		const idIndex = data.readUInt16LE();
		const totalFieldCount = data.readUInt32LE();
		const bitpackedDataOffset = data.readUInt32LE();
		const lookupColumnCount = data.readUInt32LE();
		const fieldStorageInfoSize = data.readUInt32LE();
		const commonDataSize = data.readUInt32LE();
		const palletDataSize = data.readUInt32LE();
		const sectionCount = data.readUInt32LE();

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
		for (let fieldIndex = 0, nFields = fieldInfo.length; fieldIndex < nFields; fieldIndex++){
			const thisFieldInfo = fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexed || thisFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
				palletData[fieldIndex] = new Array();
				for (let i = 0; i < thisFieldInfo.additionalDataSize / 4; i++){
					palletData[fieldIndex][i] = data.readUInt32LE();
				}
			}
		}

		// Ensure we've read the expected amount of pallet data.
		assert.strictEqual(data.offset, prevPos + palletDataSize, 'Read incorrect amount of pallet data');

		prevPos = data.offset;

		// char common_data[header.common_data_size];
		const commonData = new Array(fieldInfo.length);
		for (let fieldIndex = 0, nFields = fieldInfo.length; fieldIndex < nFields; fieldIndex++){
			const thisFieldInfo = fieldInfo[fieldIndex];
			if (thisFieldInfo.fieldCompression === CompressionType.CommonData) {
				const commonDataMap = commonData[fieldIndex] = new Map();

				for (let i = 0; i < thisFieldInfo.additionalDataSize / 8; i++)
					commonDataMap.set(data.readUInt32LE(), data.readUInt32LE());
			}
		}

		// Ensure we've read the expected amount of common data.
		assert.strictEqual(data.offset, prevPos + commonDataSize, 'Read incorrect amount of common data');

		// data_sections[header.section_count];
		const sections = new Array(sectionCount);
		const copyTable = this.copyTable;
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const header = sectionHeaders[sectionIndex];
			const isNormal = !(flags & 1);

			const recordDataOfs = data.offset;
			const recordsOfs = wdcVersion === 2 ? header.offsetMapOffset : header.offsetRecordsEnd;
			const recordDataSize = isNormal ? recordSize * header.recordCount : recordsOfs - header.fileOffset;
			const stringBlockOfs = recordDataOfs + recordDataSize;

			let offsetMap;
			if (wdcVersion === 2 && !isNormal) {
				// offset_map_entry offset_map[header.max_id - header.min_id + 1];
				const offsetMapCount = maxID - minID + 1;
				offsetMap = new Array(offsetMapCount);
				for (let i = 0, n = offsetMapCount; i < n; i++)
					offsetMap[i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };
			}

			data.seek(stringBlockOfs + header.stringTableSize);

			// uint32_t id_list[section_headers.id_list_size / 4];
			const idList = data.readUInt32LE(header.idListSize / 4);

			// copy_table_entry copy_table[section_headers.copy_table_count];
			const copyTableCount = wdcVersion === 2 ? (header.copyTableSize / 8) : header.copyTableCount
			for (let i = 0; i < copyTableCount; i++)
				copyTable.set(data.readInt32LE(), data.readInt32LE());

			if (wdcVersion === 3) {
				// offset_map_entry offset_map[section_headers.offset_map_id_count];
				offsetMap = new Array(header.offsetMapIDCount);
				for (let i = 0, n = header.offsetMapIDCount; i < n; i++)
					offsetMap[i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };
			}

			// relationship_map
			// ToDo: Read
			if (header.relationshipDataSize > 0)
				data.move((data.readUInt32LE() * 8) + 8);

			// uint32_t offset_map_id_list[section_headers.offset_map_id_count];
			// Duplicate of id_list for sections with offset records.
			// ToDo: Read
			if (wdcVersion === 3)
				data.move(header.offsetMapIDCount * 4);

			sections[sectionIndex] = { header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, idList, offsetMap };
		}

		const castBuffer = BufferWrapper.alloc(8, true);

		// Parse section records.
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const section = sections[sectionIndex];
			const header = section.header;
			const offsetMap = section.offsetMap;
			const isNormal = section.isNormal;

			// Skip parsing entries from encrypted sections.
			if (section.tactKeyHash !== BigInt(0)) {
				let isZeroed = true;
				data.seek(section.recordDataOfs);
				for (let i = 0, n = section.recordDataSize; i < n; i++) {
					if (data.readUInt8() !== 0x0) {
						isZeroed = false;
						break;
					}
				}

				if (isZeroed)
					continue;
			}

			// Total recordDataSize of all forward sections and stringBlockSize of all past sections.
			let outsideDataSize = 0;
			for (let i = 0; i < sectionCount; i++) {
				if (i > sectionIndex)
					outsideDataSize += sections[i].recordDataSize;
				else if (i < sectionIndex)
					outsideDataSize += sections[i].header.stringTableSize;
			}

			const hasIDMap = section.idList.length > 0;
			for (let i = 0, n = header.recordCount; i < n; i++) {
				let recordID;

				if (hasIDMap)
					recordID = section.idList[i];

				const recordOfs = isNormal ? i * recordSize : offsetMap[i].offset;
				const actualRecordSize = isNormal ? recordSize : offsetMap[i].size;
				const recordEnd = section.recordDataOfs + recordOfs + actualRecordSize;

				// Append 8 bytes (a full uint64) to buffer to prevent hitting the buffer limit when reading bitpacked fields.
				if (recordEnd + 8 > data.byteLength){
					data.setCapacity(data.byteLength + 8, true);
				}

				data.seek(section.recordDataOfs + recordOfs);

				const out = {};
				let fieldIndex = 0;
				for (const [prop, type] of Object.entries(this.schema)) {
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
									const ofs = data.readUInt32LE();
									const pos = data.offset;

									data.move((ofs - 4) - outsideDataSize);
									out[prop] = data.readString(data.indexOf(0x0) - data.offset, 'utf8');

									data.seek(pos);
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
						case CompressionType.BitpackedIndexedArray:
							// ToDo: All bitpacked stuff requires testing on more DB2s before being able to call it done.

							data.seek(section.recordDataOfs + recordOfs + fieldOffsetBytes);

							// Read bitpacked value, in the case BitpackedIndex(Array) this is an index into palletData.
							const bitpackedValue = data.readUInt64LE() >> (BigInt(recordFieldInfo.fieldOffsetBits) & BigInt(7)) & ((BigInt(1) << BigInt(recordFieldInfo.fieldSizeBits)) - BigInt(1));

							if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexedArray) {
								out[prop] = new Array(recordFieldInfo.fieldCompressionPacking[2]);
								for (let i = 0; i < recordFieldInfo.fieldCompressionPacking[2]; i++)
									out[prop][i] = palletData[fieldIndex][(bitpackedValue * BigInt(recordFieldInfo.fieldCompressionPacking[2])) + BigInt(i)];
							} else if (recordFieldInfo.fieldCompression === CompressionType.BitpackedIndexed) {
								out[prop] = palletData[fieldIndex][bitpackedValue];
							} else {
								out[prop] = bitpackedValue;
							}

							break;
					}

					// Reinterpret field correctly for compression types other than None
					if (recordFieldInfo.fieldCompression !== CompressionType.None) {
						// ToDo: Can arrays of other types than uint be bitpacked? If so, this needs support. Also, strings. 
						if (!Array.isArray(type)){
							castBuffer.seek(0);
							castBuffer.writeBigUInt64LE(BigInt(out[prop]));
							castBuffer.seek(0);
							switch (fieldType) {
								case FieldType.String:
									throw new Error("Strings currently not supported.");

								case FieldType.Int8: out[prop] = castBuffer.readInt8(); break;
								case FieldType.UInt8: out[prop] = castBuffer.readUInt8(); break;
								case FieldType.Int16: out[prop] = castBuffer.readInt16LE(); break;
								case FieldType.UInt16: out[prop] = castBuffer.readUInt16LE(); break;
								case FieldType.Int32: out[prop] = castBuffer.readInt32LE(); break;
								case FieldType.UInt32: out[prop] = castBuffer.readUInt32LE(); break;
								case FieldType.Int64: out[prop] = castBuffer.readInt64LE(); break;
								case FieldType.UInt64: out[prop] = castBuffer.readUInt64LE(); break;
								case FieldType.Float: out[prop] = Math.round(castBuffer.readFloatLE() * 100) / 100; break;
							}
						}
					}

					if (!hasIDMap && fieldIndex === idIndex)
						recordID = out[prop];

					fieldIndex++;
				}

				this.rows.set(recordID, out);
			}
		}

		log.write('Parsed %s with %d rows', this.fileName, this.size);
		this.isLoaded = true;
	}
}

module.exports = WDCReader;