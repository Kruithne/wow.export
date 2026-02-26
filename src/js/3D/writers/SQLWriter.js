/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import FileWriter from '../../file-writer.js';
import generics from '../../generics.js';
import FieldType from '../../db/FieldType.js';




const BATCH_SIZE = 100;

class SQLWriter {
	/**
	 * Construct a new SQLWriter instance.
	 * @param {string} out
	 * @param {string} table_name
	 */
	constructor(out, table_name) {
		this.out = out;
		this.table_name = table_name;
		this.fields = [];
		this.rows = [];
		this.schema = null;
		this.include_ddl = false;
	}

	/**
	 * Set the schema for DDL generation.
	 * @param {Map} schema - WDCReader schema map
	 */
	setSchema(schema) {
		this.schema = schema;
	}

	/**
	 * Enable or disable DDL generation.
	 * @param {boolean} include
	 */
	setIncludeDDL(include) {
		this.include_ddl = include;
	}

	/**
	 * Add fields to this SQL.
	 * @param  {...string} fields
	 */
	addField(...fields) {
		this.fields.push(...fields);
	}

	/**
	 * Add a row to this SQL.
	 * @param {object} row
	 */
	addRow(row) {
		this.rows.push(row);
	}

	/**
	 * Escape a SQL value for safe insertion.
	 * @param {*} value - The value to escape
	 * @returns {string} - The escaped value
	 */
	escapeSQLValue(value) {
		if (value === null || value === undefined)
			return 'NULL';

		const str = value.toString();

		// numeric values don't need quotes
		if (!isNaN(value) && str.trim() !== '')
			return str;

		// escape single quotes and wrap in quotes
		return '\'' + str.replace(/'/g, '\'\'') + '\'';
	}

	/**
	 * Escape a SQL identifier (table/column name).
	 * @param {string} name - The identifier to escape
	 * @returns {string} - The escaped identifier
	 */
	escapeIdentifier(name) {
		return '`' + name.replace(/`/g, '``') + '`';
	}

	/**
	 * Convert a FieldType to a SQL type string.
	 * @param {Symbol|Array} field_type - FieldType symbol or [symbol, arrayLength]
	 * @param {string} field_name - Field name for context
	 * @returns {string} - SQL type
	 */
	fieldTypeToSQL(field_type, field_name) {
		let base_type = field_type;
		let is_array = false;

		if (Array.isArray(field_type)) {
			base_type = field_type[0];
			is_array = true;
		}

		// arrays stored as TEXT (JSON or comma-separated)
		if (is_array)
			return 'TEXT';

		switch (base_type) {
			case FieldType.String:
				return 'TEXT';

			case FieldType.Int8:
			case FieldType.UInt8:
				return 'SMALLINT';

			case FieldType.Int16:
			case FieldType.UInt16:
				return 'SMALLINT';

			case FieldType.Int32:
			case FieldType.UInt32:
			case FieldType.Relation:
			case FieldType.NonInlineID:
				return 'INT';

			case FieldType.Int64:
			case FieldType.UInt64:
				return 'BIGINT';

			case FieldType.Float:
				return 'REAL';

			default:
				return 'TEXT';
		}
	}

	/**
	 * Generate DROP TABLE and CREATE TABLE DDL.
	 * @returns {string} - DDL statements
	 */
	generateDDL() {
		if (!this.schema || this.fields.length === 0)
			return '';

		const escaped_table = this.escapeIdentifier(this.table_name);
		const lines = [];

		lines.push(`DROP TABLE IF EXISTS ${escaped_table};`);
		lines.push('');

		const column_defs = [];
		let primary_key = null;

		for (const field of this.fields) {
			const field_type = this.schema.get(field);
			const sql_type = this.fieldTypeToSQL(field_type, field);
			const escaped_field = this.escapeIdentifier(field);

			// ID field is typically the primary key
			if (field.toUpperCase() === 'ID') {
				column_defs.push(`\t${escaped_field} ${sql_type} NOT NULL`);
				primary_key = escaped_field;
			} else {
				column_defs.push(`\t${escaped_field} ${sql_type}`);
			}
		}

		if (primary_key)
			column_defs.push(`\tPRIMARY KEY (${primary_key})`);

		lines.push(`CREATE TABLE ${escaped_table} (`);
		lines.push(column_defs.join(',\n'));
		lines.push(');');
		lines.push('');

		return lines.join('\n');
	}

	/**
	 * Convert rows to batched SQL INSERT statements.
	 * @returns {string} - SQL INSERT statements
	 */
	toSQL() {
		if (this.rows.length === 0)
			return '';

		const lines = [];
		const escaped_table = this.escapeIdentifier(this.table_name);
		const escaped_fields = this.fields.map(f => this.escapeIdentifier(f)).join(', ');

		for (let i = 0; i < this.rows.length; i += BATCH_SIZE) {
			const batch = this.rows.slice(i, i + BATCH_SIZE);
			const value_rows = batch.map(row => {
				const values = this.fields.map(field => this.escapeSQLValue(row[field])).join(', ');
				return `(${values})`;
			});

			lines.push(`INSERT INTO ${escaped_table} (${escaped_fields}) VALUES`);
			lines.push(value_rows.join(',\n') + ';');
			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * Write the SQL to disk.
	 * @param {boolean} overwrite
	 */
	async write(overwrite = true) {
		if (this.rows.length === 0)
			return;

		if (!overwrite && await generics.fileExists(this.out))
			return;

		await generics.createDirectory(this.out.substring(0, this.out.lastIndexOf('/')));
		const writer = new FileWriter(this.out);

		if (this.include_ddl && this.schema) {
			const ddl = this.generateDDL();
			if (ddl)
				await writer.writeLine(ddl);
		}

		const sql = this.toSQL();
		await writer.writeLine(sql);

		writer.close();
	}
}

export default SQLWriter;