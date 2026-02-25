// casc file system and listfile handlers
// these stubs will be wired to the actual casc subsystem during migration

const NOT_IMPL = 'not implemented: casc subsystem not yet migrated';

export const casc_handlers = {
	// casc lifecycle
	async casc_init_local({ path }) {
		throw new Error(NOT_IMPL);
	},

	async casc_init_remote({ region, product }) {
		throw new Error(NOT_IMPL);
	},

	async casc_load({ build_key }) {
		throw new Error(NOT_IMPL);
	},

	async casc_close() {
		throw new Error(NOT_IMPL);
	},

	// file extraction
	async casc_get_file({ file_data_id }) {
		throw new Error(NOT_IMPL);
	},

	async casc_get_file_by_name({ name }) {
		throw new Error(NOT_IMPL);
	},

	async casc_get_file_partial({ file_data_id, offset, length }) {
		throw new Error(NOT_IMPL);
	},
};

export const listfile_handlers = {
	async listfile_get_by_id({ id }) {
		throw new Error(NOT_IMPL);
	},

	async listfile_get_by_name({ name }) {
		throw new Error(NOT_IMPL);
	},

	async listfile_get_filtered({ filter, ext, prefilter }) {
		throw new Error(NOT_IMPL);
	},

	async listfile_get_prefilter({ type }) {
		throw new Error(NOT_IMPL);
	},

	async listfile_get_tree({ path }) {
		throw new Error(NOT_IMPL);
	},

	async listfile_strip_prefix({ name }) {
		throw new Error(NOT_IMPL);
	},
};
