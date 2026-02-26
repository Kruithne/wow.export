// rpc schema definition for wow.export
// documents all RPC methods between the bun process and webview.
// this is the single source of truth for the RPC surface area.

// -- request timeout for long-running operations (casc init, exports)
export const MAX_REQUEST_TIME = 120_000;

// -- bun-side request handlers (view calls bun) --

/**
 * filesystem operations
 *
 * fs_read_file: { path: string, offset?: number, length?: number } => string (base64)
 * fs_write_file: { path: string, data: string (base64), encoding?: string } => void
 * fs_write_text: { path: string, text: string, encoding?: string } => void
 * fs_mkdir: { path: string } => void
 * fs_exists: { path: string } => boolean
 * fs_readdir: { path: string } => string[]
 * fs_stat: { path: string } => { size: number, mtime: number }
 * fs_delete_dir: { path: string } => { freed: number }
 * fs_is_writable: { path: string } => boolean
 * fs_file_hash: { path: string, algorithm: string, encoding: string } => string
 * fs_read_json: { path: string, strip_comments?: boolean } => object | null
 * fs_write_json: { path: string, data: object } => void
 */

/**
 * casc file system operations
 *
 * casc_init_local: { path: string } => { builds: BuildInfo[] }
 * casc_init_remote: { region: string, product: string } => { builds: BuildInfo[] }
 * casc_load: { build_key: string } => void
 * casc_close: {} => void
 * casc_get_file: { file_data_id: number } => string (base64)
 * casc_get_file_by_name: { name: string } => string (base64)
 * casc_get_file_partial: { file_data_id: number, offset: number, length: number } => string (base64)
 * casc_add_tact_key: { key_name: string, key: string } => boolean
 */

/**
 * listfile operations
 *
 * listfile_get_by_id: { id: number } => string | null
 * listfile_get_by_name: { name: string } => number | null
 * listfile_get_filtered: { filter: string, ext?: string, prefilter?: string } => Array<[number, string]>
 * listfile_get_prefilter: { type: string } => Array<[number, string]>
 * listfile_strip_prefix: { name: string } => string
 */

/**
 * database operations
 *
 * db_load: { table: string } => { columns: string[], rows: any[][] }
 * db_preload: { table: string } => { count: number }
 * db_get_row: { table: string, id: number } => object | null
 */

/**
 * db cache operations (high-level pre-joined queries)
 *
 * dbc_get_items: { filter?: string } => Item[]
 * dbc_get_item_displays: { item_id: number } => ItemDisplay[]
 * dbc_get_item_models: { display_id: number } => ItemModel[]
 * dbc_get_item_geosets: { item_id: number } => ItemGeoset[]
 * dbc_get_item_char_textures: { item_id: number } => CharTexture[]
 * dbc_get_creatures: { filter?: string } => Creature[]
 * dbc_get_creature_displays: { creature_id: number } => CreatureDisplay[]
 * dbc_get_creature_equipment: { creature_id: number } => NpcEquipment
 * dbc_get_character_customization: { race: number, gender: number } => CustomizationData
 * dbc_get_model_file_data: { model_id: number } => ModelFileData[]
 * dbc_get_texture_file_data: { texture_id: number } => TextureFileData[]
 * dbc_get_component_models: { race: number, gender: number, class: number } => ComponentModel[]
 * dbc_get_decor: { filter?: string } => Decor[]
 * dbc_get_decor_categories: {} => DecorCategory[]
 * dbc_get_guild_tabard: { params: object } => TabardData
 * dbc_call: { module: string, method: string, args?: any[] } => any (generic db cache dispatcher)
 */

/**
 * mpq operations (legacy MPQ-based installations)
 *
 * mpq_init: { path: string } => { build_id: string }
 * mpq_close: {} => void
 * mpq_get_file: { path: string } => string (base64) | null
 * mpq_get_files_by_extension: { extension: string } => string[]
 * mpq_get_all_files: {} => string[]
 * mpq_get_build_id: {} => string | null
 */

/**
 * platform operations (shell, clipboard, dialog, system)
 *
 * platform_open_path: { path: string } => void
 * platform_open_url: { url: string } => void
 * platform_clipboard_write_text: { text: string } => void
 * platform_clipboard_write_image: { data: string (base64) } => void
 * platform_clipboard_read_text: {} => string
 * platform_show_open_dialog: { title?: string, filters?: object[], default_path?: string, multi?: boolean } => string[] | null
 * platform_show_save_dialog: { title?: string, filters?: object[], default_path?: string } => string | null
 * platform_get_gpu_info: {} => { name: string, vram: string, driver: string } | null
 * platform_get_screen_info: {} => { width: number, height: number, scale: number }
 */

/**
 * config operations
 *
 * config_get: {} => object
 * config_set: { key: string, value: any } => void
 * config_reset_key: { key: string } => void
 * config_reset_all: {} => void
 * config_get_defaults: {} => object
 */

/**
 * app info operations
 *
 * app_get_info: {} => { version: string, flavour: string, guid: string, data_path: string }
 * app_get_constants: {} => Constants
 * app_check_update: {} => { version?: string, hash?: string, updateAvailable: boolean, updateReady: boolean, error?: string }
 * app_download_update: {} => { success: boolean, error?: string }
 * app_apply_update: {} => void
 * app_get_cache_size: {} => number
 * app_clear_cache: { type: string } => void
 */

/**
 * export operations
 *
 * export_files: { files: ExportFile[], dir: string, format?: string } => { success: boolean, count: number }
 * export_raw: { data: string (base64), path: string } => void
 * export_text: { text: string, path: string } => void
 * export_get_path: { file: string } => string
 * export_get_incremental: { path: string } => string
 */

/**
 * log operations
 *
 * log_get_path: {} => string
 * log_open: {} => void
 */

// -- bun → view messages (fire-and-forget, bun sends to view) --

/**
 * casc_progress: { message: string, pct: number, is_done?: boolean }
 * export_progress: { current: number, total: number, file?: string }
 * loading_progress: { message: string, pct?: number }
 * config_changed: { key: string, value: any }
 * update_status: { status: string, progress?: number, error?: string }
 * toast: { message: string, type?: string }
 */

// -- view → bun messages (fire-and-forget, view sends to bun) --

/**
 * log_write: { level: string, message: string, args?: any[] }
 */

// -- message name constants --

export const MSG = {
	CASC_PROGRESS: 'casc_progress',
	EXPORT_PROGRESS: 'export_progress',
	LOADING_PROGRESS: 'loading_progress',
	CONFIG_CHANGED: 'config_changed',
	UPDATE_STATUS: 'update_status',
	TOAST: 'toast',
	LOG_WRITE: 'log_write',
};
