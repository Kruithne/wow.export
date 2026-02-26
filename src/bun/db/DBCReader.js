import { format } from 'node:util';
import { basename } from 'node:path';

import * as log from '../lib/log.js';
import * as core from '../lib/core.js';
import * as generics from '../lib/generics.js';
import * as constants from '../lib/constants.js';

import ExportHelper from '../casc/export-helper.js';
import { DBDParser } from './DBDParser.js';
import * as FieldType from './FieldType.js';
import * as dbd_manifest from '../casc/dbd-manifest.js';

const DBC_MAGIC = 0x43424457;

const LOCALE_COUNT_PRE_WOTLK = 8;
const LOCALE_COUNT_WOTLK = 16;

const convert_dbd_to_schema_type = (entry) => {
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
			default: return entry.isSigned ? FieldType.Int32 : FieldType.UInt32;
		}
	}

	return FieldType.UInt32;
};

class DBCReader {
	constructor(file_name, build_id) {
		this.file_name = file_name;
		this.build_id = build_id;

		this.schema = new Map();
		this.is_loaded = false;

		this.rows = null;
		this.data = null;
		this.string_block = null;
		this.string_block_offset = 0;

		this.record_count = 0;
		this.field_count = 0;
		this.record_size = 0;
		this.string_block_size = 0;

		this.locale_count = this._get_locale_count(build_id);
	}

	_get_locale_count(build_id) {
		const parts = build_id.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
		if (!parts)
			return LOCALE_COUNT_PRE_WOTLK;

		const major = parseInt(parts[1]);

		if (major >= 3)
			return LOCALE_COUNT_WOTLK;

		return LOCALE_COUNT_PRE_WOTLK;
	}

	get size() {
		return this.record_count;
	}

	getRow(index) {
		if (!this.is_loaded)
			throw new Error('Attempted to read a data table row before table was loaded.');

		if (this.rows !== null)
			return this.rows.get(index);

		return this._read_record(index);
	}

	getAllRows() {
		if (!this.is_loaded)
			throw new Error('Attempted to read a data table rows before table was loaded.');

		if (this.rows !== null)
			return this.rows;

		const rows = new Map();
		for (let i = 0; i < this.record_count; i++) {
			const record = this._read_record(i);
			if (record !== null) {
				const id = record.ID ?? i;
				rows.set(id, record);
			}
		}

		return rows;
	}

	preload() {
		if (!this.is_loaded)
			throw new Error('Attempted to preload table before it was loaded.');

		if (this.rows !== null)
			return;

		this.rows = this.getAllRows();
	}

	async loadSchema() {
		const raw_table_name = ExportHelper.replaceExtension(basename(this.file_name));

		await dbd_manifest.prepareManifest();
		const all_tables = dbd_manifest.getAllTableNames();
		const table_name_lower = raw_table_name.toLowerCase();
		const table_name = all_tables.find(t => t.toLowerCase() === table_name_lower) ?? raw_table_name;

		const dbd_name = table_name + '.dbd';

		let structure = null;
		log.write('Loading table definitions %s (%s)...', dbd_name, this.build_id);

		const casc = core.get_casc();
		const cache = casc?.cache;
		const cache_key = dbd_name.toLowerCase();
		let raw_dbd = cache ? await cache.getFile(cache_key, constants.CACHE.DIR_DBD) : null;

		if (raw_dbd !== null)
			structure = new DBDParser(raw_dbd).getStructure(this.build_id, null);

		if (structure === null) {
			const dbd_url = format(core.get_config('dbdURL'), table_name);
			const dbd_url_fallback = format(core.get_config('dbdFallbackURL'), table_name);

			try {
				log.write(`No cached DBD or no matching structure, downloading from ${dbd_url}`);
				raw_dbd = await generics.downloadFile([dbd_url, dbd_url_fallback]);

				if (cache)
					await cache.storeFile(cache_key, raw_dbd, constants.CACHE.DIR_DBD);

				structure = new DBDParser(raw_dbd).getStructure(this.build_id, null);
			} catch (e) {
				log.write('Failed to download DBD for %s: %s', table_name, e.message);
			}
		}

		if (structure === null) {
			log.write('No table definition available for %s, using raw field names', table_name);
			this._build_fallback_schema();
			return;
		}

		this._build_schema_from_dbd(structure);
	}

	_build_schema_from_dbd(structure) {
		for (const field of structure.fields) {
			const field_type = convert_dbd_to_schema_type(field);

			if (field.type === 'locstring')
				this.schema.set(field.name, { type: field_type, is_locstring: true, array_length: field.arrayLength });
			else if (field.arrayLength > -1)
				this.schema.set(field.name, { type: field_type, array_length: field.arrayLength });
			else
				this.schema.set(field.name, { type: field_type });
		}
	}

	_build_fallback_schema() {
		for (let i = 0; i < this.field_count; i++) {
			const name = i === 0 ? 'ID' : `field_${i}`;
			this.schema.set(name, { type: FieldType.UInt32 });
		}
	}

	async parse(data) {
		log.write('Loading DBC file %s', this.file_name);

		this.data = data;

		const magic = data.readUInt32LE();
		if (magic !== DBC_MAGIC)
			throw new Error('Invalid DBC magic: ' + magic.toString(16));

		this.record_count = data.readUInt32LE();
		this.field_count = data.readUInt32LE();
		this.record_size = data.readUInt32LE();
		this.string_block_size = data.readUInt32LE();

		const records_offset = 20;
		this.string_block_offset = records_offset + (this.record_count * this.record_size);

		await this.loadSchema();

		const schema_field_count = this._calculate_schema_field_count();
		if (schema_field_count !== this.field_count) {
			log.write('Schema mismatch for %s: schema has %d fields, DBC has %d fields. Using fallback.',
				this.file_name, schema_field_count, this.field_count);
			this.schema.clear();
			this._build_fallback_schema();
		}

		log.write('Parsed DBC %s with %d rows, %d fields, %d bytes per record',
			this.file_name, this.record_count, this.field_count, this.record_size);

		this.is_loaded = true;
	}

	_calculate_schema_field_count() {
		let count = 0;
		for (const [name, field_info] of this.schema.entries()) {
			if (field_info.is_locstring) {
				const array_len = field_info.array_length > 0 ? field_info.array_length : 1;
				count += (this.locale_count + 1) * array_len;
			} else if (field_info.array_length > 0) {
				count += field_info.array_length;
			} else {
				count += 1;
			}
		}
		return count;
	}

	_read_string(offset) {
		if (offset === 0)
			return '';

		const abs_offset = this.string_block_offset + offset;
		this.data.seek(abs_offset);

		const end = this.data.indexOf(0x0);
		if (end === -1)
			return '';

		const length = end - abs_offset;
		this.data.seek(abs_offset);
		return this.data.readString(length, 'utf8');
	}

	_read_record(index) {
		if (index < 0 || index >= this.record_count)
			return null;

		const record_offset = 20 + (index * this.record_size);
		this.data.seek(record_offset);

		const out = {};
		let field_index = 0;

		for (const [name, field_info] of this.schema.entries()) {
			const field_type = field_info.type;
			const is_locstring = field_info.is_locstring ?? false;
			const array_length = field_info.array_length ?? -1;

			if (is_locstring) {
				const locstring_field_count = this.locale_count + 1;
				const locale_offsets = this.data.readUInt32LE(this.locale_count);
				this.data.readUInt32LE(); // bitmask

				let value = '';
				for (let i = 0; i < this.locale_count; i++) {
					const str = this._read_string(locale_offsets[i]);
					if (str.length > 0) {
						value = str;
						break;
					}
				}

				const next_offset = record_offset + ((field_index + locstring_field_count) * 4);
				this.data.seek(next_offset);

				out[name] = value;
				field_index += locstring_field_count;
			} else if (array_length > -1) {
				out[name] = this._read_field_array(field_type, array_length);
				field_index += array_length;
			} else {
				out[name] = this._read_field(field_type);
				field_index++;
			}
		}

		return out;
	}

	_read_field(field_type) {
		switch (field_type) {
			case FieldType.String:
				const offset = this.data.readUInt32LE();
				const pos = this.data.offset;
				const str = this._read_string(offset);
				this.data.seek(pos);
				return str;

			case FieldType.Int8: return this.data.readInt8();
			case FieldType.UInt8: return this.data.readUInt8();
			case FieldType.Int16: return this.data.readInt16LE();
			case FieldType.UInt16: return this.data.readUInt16LE();
			case FieldType.Int32: return this.data.readInt32LE();
			case FieldType.UInt32: return this.data.readUInt32LE();
			case FieldType.Float: return this.data.readFloatLE();

			default:
				return this.data.readUInt32LE();
		}
	}

	_read_field_array(field_type, count) {
		const values = new Array(count);
		for (let i = 0; i < count; i++)
			values[i] = this._read_field(field_type);

		return values;
	}
}

export default DBCReader;
