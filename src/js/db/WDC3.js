const FieldType = require('./FieldType');
const CompressionType = require('./CompressionType');

class WDC3 {
	constructor(data, schema) {
		this.data = data;
		this.schema = schema;

		this.rows = new Map();
		this.load();
	}

	load() {
		const data = this.data;

		// wdc3_db2_header
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

		// wdc3_section_header section_headers[section_count]
		const sectionHeaders = new Array(sectionCount);
		for (let i = 0; i < sectionCount; i++) {
			sectionHeaders[i] = {
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
				fieldOffsetSize: data.readUInt16LE(),
				additionalDataSize: data.readUInt32LE(),
				fieldCompression: data.readUInt32LE(),
				fieldCompressionPacking: data.readUInt32LE(3)
			};
		}

		// char pallet_data[header.pallet_data_size];
		// char common_data[header.common_data_size];
		// ToDo: Implement if needed.
		data.move(palletDataSize + commonDataSize);

		// data_sections[header.section_count];
		const sections = new Array(sectionCount);
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const header = sectionHeaders[sectionIndex];
			const isNormal = !(this.flags & 1);

			const recordDataOfs = data.offset;
			const recordDataSize = isNormal ? recordSize * header.recordCount : header.offsetRecordsEnd - header.fileOffset;
			const stringBlockOfs = recordDataOfs + recordDataSize;

			data.seek(stringBlockOfs + header.stringTableSize);

			// uint32_t id_list[section_headers.id_list_size / 4];
			const idList = data.readUInt32LE(header.idListSize / 4);

			// copy_table_entry copy_table[section_headers.copy_table_count];
			// ToDo: Implement if needed.
			data.move(header.copyTableCount * 8);

			// offset_map_entry offset_map[section_headers.offset_map_id_count];
			const offsetMap = new Array(header.offsetMapIDCount);
			for (let i = 0, n = header.offsetMapIDCount; i < n; i++)
				offsetMap[i] = { offset: data.readUInt32LE(), size: data.readUInt16LE() };

			// relationship_map
			// ToDo: Implement if needed.
			if (header.relationshipDataSize > 0)
				data.move((data.readUInt32LE() * 8) + 8);

			// uint32_t offset_map_id_list[section_headers.offset_map_id_count];
			// Duplicate of id_list for sections with offset records.
			data.move(header.offsetMapIDCount * 4);

			sections[sectionIndex] = {
				header, isNormal, recordDataOfs, recordDataSize, stringBlockOfs, idList, offsetMap
			};
		}

		// Parse section records.
		for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
			const section = sections[sectionIndex];
			const header = section.header;
			const offsetMap = section.offsetMap;
			const isNormal = section.isNormal;

			// Skip parsing entries from encrypted sections.
			if (section.tactKeyHash !== 0x0) {
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

			// For unknown reasons the 'absolute' offsets for string block lookups in
			// normal records is offset by the total recordDataSize of all other sections.
			let outsideDataSize = 0;
			for (let i = 0; i < sectionCount; i++) {
				if (i > sectionIndex)
					outsideDataSize += sections[i].recordDataSize;
				else if (i < sectionIndex)
					outsideDataSize += sections[i].header.stringTableSize;
			}

			for (let i = 0, n = header.recordCount; i < n; i++) {
				const recordID = section.idList[i];
				const recordOfs = isNormal ? i * recordSize : offsetMap[i].offset;
				const actualRecordSize = isNormal ? recordSize : offsetMap[i].size;
				const recordEnd = section.recordDataOfs + recordOfs + actualRecordSize;

				data.seek(section.recordDataOfs + recordOfs);

				const out = {};
				for (const [prop, type] of Object.entries(this.schema)) {
					// Prevent schema from flowing out-of-bounds for a record.
					// We don't bother checking if the schema is too short, allowing for partial schema.
					if (data.offset > recordEnd)
						throw new Error('DB table schema exceeds available record data.');

					// ToDo: Add support for compressed fields.

					switch (type) {
						case FieldType.String:
							const ofs = data.readUInt32LE();
							const pos = data.offset;

							data.move((ofs - 4) - outsideDataSize);
							out[prop] = this.readString();
							data.seek(pos);
							break;

						case FieldType.UInt8: out[prop] = data.readUInt8(); break;
						case FieldType.Int16: out[prop] = data.readInt16LE(); break;
						case FieldType.UInt16: out[prop] = data.readUInt16LE(); break;
						case FieldType.Int32: out[prop] = data.readInt32LE(); break;
						case FieldType.UInt32: out[prop] = data.readUInt32LE(); break;
						case FieldType.Float: out[prop] = data.readFloatLE(); break;
					}
				}

				this.rows.set(recordID, out);
			}
		}
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

module.exports = WDC3;