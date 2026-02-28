import * as log from '../lib/log.js';
import * as core from '../lib/core.js';
import db2 from '../casc/db2.js';
import { serialize, deserialize } from '../../rpc/serialize.js';
import * as dbd_manifest from '../casc/dbd-manifest.js';
import WDCReader from '../db/WDCReader.js';
import DBCReader from '../db/DBCReader.js';
import BufferWrapper from '../lib/buffer.js';
import * as FieldType from '../db/FieldType.js';

import * as DBItems from '../db/caches/DBItems.js';
import * as DBItemDisplays from '../db/caches/DBItemDisplays.js';
import * as DBItemModels from '../db/caches/DBItemModels.js';
import * as DBItemGeosets from '../db/caches/DBItemGeosets.js';
import * as DBItemCharTextures from '../db/caches/DBItemCharTextures.js';
import * as DBCreatures from '../db/caches/DBCreatures.js';
import * as DBCreaturesLegacy from '../db/caches/DBCreaturesLegacy.js';
import * as DBCreatureDisplayExtra from '../db/caches/DBCreatureDisplayExtra.js';
import * as DBCreatureList from '../db/caches/DBCreatureList.js';
import * as DBNpcEquipment from '../db/caches/DBNpcEquipment.js';
import * as DBCharacterCustomization from '../db/caches/DBCharacterCustomization.js';
import * as DBModelFileData from '../db/caches/DBModelFileData.js';
import * as DBTextureFileData from '../db/caches/DBTextureFileData.js';
import * as DBComponentModelFileData from '../db/caches/DBComponentModelFileData.js';
import * as DBDecor from '../db/caches/DBDecor.js';
import * as DBDecorCategories from '../db/caches/DBDecorCategories.js';
import * as DBGuildTabard from '../db/caches/DBGuildTabard.js';

const FIELD_TYPE_NAMES = new Map([
	[FieldType.String, 'String'],
	[FieldType.Int8, 'Int8'],
	[FieldType.UInt8, 'UInt8'],
	[FieldType.Int16, 'Int16'],
	[FieldType.UInt16, 'UInt16'],
	[FieldType.Int32, 'Int32'],
	[FieldType.UInt32, 'UInt32'],
	[FieldType.Int64, 'Int64'],
	[FieldType.UInt64, 'UInt64'],
	[FieldType.Float, 'Float'],
	[FieldType.Relation, 'Relation'],
	[FieldType.NonInlineID, 'NonInlineID'],
]);

const serialize_schema = (schema) => {
	const result = {};
	for (const [key, value] of schema) {
		if (Array.isArray(value))
			result[key] = [FIELD_TYPE_NAMES.get(value[0]) ?? 'UInt32', value[1]];
		else if (typeof value === 'object' && value !== null && value.type)
			result[key] = FIELD_TYPE_NAMES.get(value.type) ?? 'UInt32';
		else
			result[key] = FIELD_TYPE_NAMES.get(value) ?? 'UInt32';
	}
	return result;
};

export const db_handlers = {
	async db_load({ table }) {
		log.write('db_load: %s', table);
		const reader = db2[table];
		if (!reader)
			throw new Error('unknown table: ' + table);

		const rows = await reader.getAllRows();
		const columns = reader.schema?.fields?.map(f => f.name) ?? [];

		const serialized_rows = [];
		for (const [id, row] of rows)
			serialized_rows.push({ id, ...row });

		return { columns, rows: serialized_rows };
	},

	async db_load_table({ table_name }) {
		log.write('db_load_table: %s', table_name);

		const reader = new WDCReader('DBFilesClient/' + table_name + '.db2');
		await reader.parse();

		const all_headers = [...reader.schema.keys()];
		const id_index = all_headers.findIndex(h => h.toUpperCase() === 'ID');
		if (id_index > 0) {
			const id_header = all_headers.splice(id_index, 1)[0];
			all_headers.unshift(id_header);
		}

		const rows = await reader.getAllRows();
		const parsed = Array(rows.size);

		let index = 0;
		for (const row of rows.values()) {
			const row_values = Object.values(row);
			if (id_index > 0) {
				const id_value = row_values.splice(id_index, 1)[0];
				row_values.unshift(id_value);
			}
			parsed[index++] = row_values;
		}

		return { headers: all_headers, rows: parsed, schema: serialize_schema(reader.schema) };
	},

	async db_load_legacy_table({ table_name, file_path }) {
		log.write('db_load_legacy_table: %s', table_name);

		const mpq = core.get_mpq();
		if (!mpq)
			throw new Error('no MPQ source loaded');

		const raw_data = mpq.getFile(file_path);
		if (!raw_data)
			throw new Error('unable to load DBC file: ' + file_path);

		const build_id = mpq.build_id ?? '1.12.1.5875';
		const dbc_reader = new DBCReader(table_name + '.dbc', build_id);
		await dbc_reader.parse(new BufferWrapper(raw_data));

		const all_headers = [...dbc_reader.schema.keys()];
		const id_index = all_headers.findIndex(h => h.toUpperCase() === 'ID');
		if (id_index > 0) {
			const id_header = all_headers.splice(id_index, 1)[0];
			all_headers.unshift(id_header);
		}

		const rows = dbc_reader.getAllRows();
		const parsed = Array(rows.size);

		let index = 0;
		for (const row of rows.values()) {
			const row_values = [];
			for (const header of all_headers) {
				const value = row[header];
				if (Array.isArray(value))
					row_values.push(value.join(', '));
				else
					row_values.push(value);
			}
			parsed[index++] = row_values;
		}

		return { headers: all_headers, rows: parsed, schema: serialize_schema(dbc_reader.schema) };
	},

	async db_get_available_tables() {
		await dbd_manifest.prepareManifest();
		return dbd_manifest.getAllTableNames();
	},

	async db_get_table_data_id({ table_name }) {
		await dbd_manifest.prepareManifest();
		return dbd_manifest.getByTableName(table_name) ?? null;
	},

	async db_get_all_rows({ table }) {
		const reader = db2[table];
		if (!reader)
			throw new Error('unknown table: ' + table);

		const rows = await reader.getAllRows();
		const result = [];
		for (const [id, row] of rows)
			result.push({ id, ...row });

		return result;
	},

	async db_get_relation_rows({ table, foreign_key }) {
		const reader = db2[table];
		if (!reader)
			throw new Error('unknown table: ' + table);

		return reader.getRelationRows(foreign_key);
	},

	async db_preload({ table }) {
		log.write('db_preload: %s', table);
		const reader = await db2.preload[table]();
		const rows = reader.getAllRows();
		return { count: rows.size };
	},

	async db_get_row({ table, id }) {
		const reader = db2[table];
		if (!reader)
			throw new Error('unknown table: ' + table);

		const row = await reader.getRow(id);
		return row ?? null;
	},
};

const DB_MODULES = {
	DBCharacterCustomization,
	DBCreatures,
	DBCreatureDisplayExtra,
	DBCreatureList,
	DBItemGeosets,
	DBItemModels,
	DBItemCharTextures,
	DBItems,
	DBNpcEquipment,
	DBGuildTabard,
	DBModelFileData,
	DBTextureFileData,
	DBItemDisplays,
	DBDecor,
	DBDecorCategories,
};

export const db_cache_handlers = {
	async dbc_call({ module, method, args }) {
		const mod = DB_MODULES[module];
		if (!mod)
			throw new Error('unknown db module: ' + module);

		const member = mod[method];
		if (member === undefined)
			throw new Error('unknown method: ' + module + '.' + method);

		if (typeof member === 'function') {
			const deserialized_args = (args ?? []).map(deserialize);
			const result = await member(...deserialized_args);
			return serialize(result);
		}

		return serialize(member);
	},

	async dbc_get_items({ filter }) {
		await DBItems.ensureInitialized();
		return DBItems;
	},

	async dbc_get_item_displays({ item_id }) {
		await DBItemDisplays.initializeItemDisplays?.();
		return DBItemDisplays.getItemDisplaysByFileDataID?.(item_id) ?? [];
	},

	async dbc_get_item_models({ display_id }) {
		await DBItemModels.ensureInitialized();
		return DBItemModels.getItemModels?.(display_id) ?? [];
	},

	async dbc_get_item_geosets({ item_id }) {
		await DBItemGeosets.ensureInitialized();
		return DBItemGeosets.getItemGeosetData?.(item_id) ?? null;
	},

	async dbc_get_item_char_textures({ item_id }) {
		await DBItemCharTextures.ensureInitialized();
		return DBItemCharTextures.getItemTextures?.(item_id) ?? null;
	},

	async dbc_get_creatures({ filter }) {
		await DBCreatures.initializeCreatureData?.();
		return DBCreatures;
	},

	async dbc_get_creature_displays({ creature_id }) {
		await DBCreatureDisplayExtra.ensureInitialized();
		return DBCreatureDisplayExtra.get_extra?.(creature_id) ?? null;
	},

	async dbc_get_creature_equipment({ creature_id }) {
		await DBNpcEquipment.ensureInitialized();
		return DBNpcEquipment.get_equipment?.(creature_id) ?? null;
	},

	async dbc_get_character_customization({ race, gender }) {
		return DBCharacterCustomization;
	},

	async dbc_get_model_file_data({ model_id }) {
		await DBModelFileData.initializeModelFileData?.();
		return DBModelFileData.getModelFileDataID?.(model_id) ?? null;
	},

	async dbc_get_texture_file_data({ texture_id }) {
		await DBTextureFileData.ensureInitialized();
		return DBTextureFileData.getTextureFDIDsByMatID?.(texture_id) ?? null;
	},

	async dbc_get_component_models({ race, gender, class: class_id }) {
		await DBComponentModelFileData.initialize?.();
		return DBComponentModelFileData.getModelsForRaceGenderByPosition?.(race, gender) ?? null;
	},

	async dbc_get_decor({ filter }) {
		await DBDecor.initializeDecorData?.();
		return DBDecor.getAllDecorItems?.() ?? [];
	},

	async dbc_get_decor_categories() {
		await DBDecorCategories.initialize_categories?.();
		return {
			categories: DBDecorCategories.get_all_categories?.() ?? [],
			subcategories: DBDecorCategories.get_all_subcategories?.() ?? [],
		};
	},

	async dbc_get_guild_tabard(params) {
		await DBGuildTabard.ensureInitialized();
		return DBGuildTabard;
	},

	async dbc_init_creature_data_legacy() {
		const mpq = core.get_mpq();
		if (!mpq)
			throw new Error('no MPQ source loaded');

		await DBCreaturesLegacy.initializeCreatureData(mpq, mpq.build_id);
	},

	async dbc_get_creature_displays_by_path_legacy({ model_path }) {
		return DBCreaturesLegacy.getCreatureDisplaysByPath(model_path) ?? [];
	},
};
