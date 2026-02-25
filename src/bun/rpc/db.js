// database and db cache handlers
// stubs for WDCReader/DBCReader queries and high-level cache lookups

const NOT_IMPL = 'not implemented: db subsystem not yet migrated';

export const db_handlers = {
	async db_load({ table }) {
		throw new Error(NOT_IMPL);
	},

	async db_preload({ table }) {
		throw new Error(NOT_IMPL);
	},

	async db_get_row({ table, id }) {
		throw new Error(NOT_IMPL);
	},
};

export const db_cache_handlers = {
	// items
	async dbc_get_items({ filter }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_item_displays({ item_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_item_models({ display_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_item_geosets({ item_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_item_char_textures({ item_id }) {
		throw new Error(NOT_IMPL);
	},

	// creatures
	async dbc_get_creatures({ filter }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_creature_displays({ creature_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_creature_equipment({ creature_id }) {
		throw new Error(NOT_IMPL);
	},

	// characters
	async dbc_get_character_customization({ race, gender }) {
		throw new Error(NOT_IMPL);
	},

	// models / textures
	async dbc_get_model_file_data({ model_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_texture_file_data({ texture_id }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_component_models({ race, gender, class: class_id }) {
		throw new Error(NOT_IMPL);
	},

	// decor
	async dbc_get_decor({ filter }) {
		throw new Error(NOT_IMPL);
	},

	async dbc_get_decor_categories() {
		throw new Error(NOT_IMPL);
	},

	// guild tabard
	async dbc_get_guild_tabard(params) {
		throw new Error(NOT_IMPL);
	},
};
