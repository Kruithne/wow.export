const assert = require('assert').strict;
const FieldType = require('./FieldType');
const CompressionType = require('./CompressionType');
const log = require('../log');

/**
 * Defines unified logic between WDC2 and WDC3.
 * @class WDC
 */
class WDC {
	/**
	 * Identifier for WDC2 variations.
	 */
	static get FORMAT_WDC2() {
		return 0x2;
	}

	/**
	 * Identifier for WDC3 variations.
	 */
	static get FORMAT_WDC3() {
		return 0x3;
	}

	/**
	 * Construct a new WDC instance.
	 * @param {BufferWrapper} data 
	 * @param {object} schema 
	 * @param {number} variant
	 */
	constructor(data, schema, variant) {
		this.data = data;
		this.schema = schema;
		this.variant = variant;

		this.rows = new Map();
		this.parse();
	}

	/**
	 * Parse the data table.
	 */
	parse() {
		const data = this.data;
		const isWDC2 = this.variant === WDC.FORMAT_WDC2;

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
			sectionHeaders[i] = isWDC2 ? {
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
				for (let i = 0; i < thisFieldInfo.additionalDataSize / 4; i++)
					palletData[fieldIndex][i] = data.readUInt32LE();
			}
		}

		// Ensure we've read the expected amount of pallet data.
		assert.strictEqual(data.offset, prevPos + palletDataSize, 'Read incorrect amount of pallet data');

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

		// data_sections[header.section_count];
		const sections = new Array(sectionCount);
		const copyTable = new Map();
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const header = sectionHeaders[sectionIndex];
			const isNormal = !(this.flags & 1);

			const recordDataOfs = data.offset;
			const recordsOfs = isWDC2 ? header.offsetMapOffset : header.offsetRecordsEnd;
			const recordDataSize = isNormal ? recordSize * header.recordCount : recordsOfs - header.fileOffset;
			const stringBlockOfs = recordDataOfs + recordDataSize;

			let offsetMap;
			if (isWDC2 && !isNormal) {
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
			const copyTableCount = isWDC2 ? (header.copyTableSize / 8) : header.copyTableCount
			for (let i = 0; i < copyTableCount; i++)
				copyTable.set(data.readInt32LE(), data.readInt32LE());

			if (!isWDC2) {
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
			if (!isWDC2)
				data.move(header.offsetMapIDCount * 4);

			sections[sectionIndex] = { header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, idList, offsetMap, copyTable };
		}

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

				data.seek(section.recordDataOfs + recordOfs);

				const out = {};
				let fieldIndex = 0;
				for (const [prop, type] of Object.entries(this.schema)) {
					// Prevent schema from flowing out-of-bounds for a record.
					// We don't bother checking if the schema is too short, allowing for partial schema.
					//if (data.offset > recordEnd)
					//	throw new Error('DB table schema exceeds available record data.');

					const thisFieldInfo = fieldInfo[fieldIndex];
					let count = 1;
					let fieldType = type;
					if (Array.isArray(type))
						[fieldType, count] = type;

					switch (thisFieldInfo.fieldCompression) {
						case CompressionType.None:
							switch (fieldType) {
								case FieldType.String:
									const ofs = data.readUInt32LE();
									const pos = data.offset;

									data.move((ofs - 4) - outsideDataSize);
									out[prop] = this.readString();
									data.seek(pos);
									break;

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
								out[prop] = thisFieldInfo.fieldCompressionPacking[0]; // Default value
							break;

						case CompressionType.Bitpacked:
						case CompressionType.BitpackedSigned:
							// ToDo: Everything is UInt32 right now, expand Bitpacked reading support to all types/signedness
							const fieldSizeBytes = (thisFieldInfo.fieldSizeBits + (thisFieldInfo.fieldOffsetBits & 7) + 7) / 8;
							let result;

							if (fieldSizeBytes > 4) {
								throw new Error('This field will require 64-bit reading/bitmasking stuff (not yet implemented).');
								// For fully compliant DB2 support we need to be able to do the same for 64 bit values. Need further implementing/testing.
								// const fieldData = data.readUInt64LE() >> (BigInt(thisFieldInfo.fieldOffsetBits) & BigInt(7));
								// result = fieldData & ((BigInt(1) << BigInt(thisFieldInfo.fieldSizeBits)) - BigInt(1));
							} else {
								const fieldData = data.readUInt32LE() >> (thisFieldInfo.fieldOffsetBits & 7);
								result = fieldData & ((1 << thisFieldInfo.fieldSizeBits) - 1);
							}

							out[prop] = result;

							break;

						case CompressionType.BitpackedIndexed:
						case CompressionType.BitpackedIndexedArray:
							// ToDo: What follows is incredibly broken and outputs wrong data, but data nonetheless
							if (count > 1){
								out[prop] = new Array(count);
								for (let i = 0; i < count; i++){
									const fieldData = data.readUInt32LE() >> (thisFieldInfo.fieldOffsetBits & 7);
									let res = fieldData & ((1 << thisFieldInfo.fieldSizeBits) - 1);
									out[prop][i] = palletData[fieldIndex][res];
								}
							} else {
								const fieldData = data.readUInt32LE() >> (thisFieldInfo.fieldOffsetBits & 7);
								let res = fieldData & ((1 << thisFieldInfo.fieldSizeBits) - 1);
								out[prop] = palletData[fieldIndex][res];
							}

							break;
					}

					if (!hasIDMap && fieldIndex === idIndex)
						recordID = out[prop];

					fieldIndex++;
				}

				this.rows.set(recordID, out);
			}
		}

		// Inflate duplicated rows.
		for (const [destID, srcID] of copyTable)
			this.rows.set(destID, this.rows.get(srcID));
	}

	readString() {
		const data = this.data;
		const startOfs = data.offset;

		let len = 0;
		while (data.readUInt8() !== 0x0)
			len++;

		data.seek(startOfs);
		return data.readString(len, 'utf8');
	}
}

module.exports = WDC;