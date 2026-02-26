import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import * as listfile from '../casc/listfile.js';
import * as tactKeys from '../casc/tact-keys.js';
import * as realmlist from '../casc/realmlist.js';
import CASCLocal from '../casc/casc-source-local.js';
import CASCRemote from '../casc/casc-source-remote.js';

export const casc_handlers = {
	async casc_init_local({ path }) {
		log.write('casc_init_local: %s', path);
		const casc = new CASCLocal(path);
		const builds = await casc.init();
		return { builds };
	},

	async casc_init_remote({ region, product }) {
		log.write('casc_init_remote: %s / %s', region, product);
		const casc = new CASCRemote(region, product);
		const builds = await casc.init();
		return { builds };
	},

	async casc_load({ build_key, cdn_region }) {
		log.write('casc_load: %s (cdn: %s)', build_key, cdn_region);
		const casc = core.get_casc();
		if (!casc)
			throw new Error('no CASC source initialized');

		if (cdn_region)
			core.set_selected_cdn_region(cdn_region);

		await tactKeys.load();
		await listfile.preload();
		await realmlist.load();

		await casc.load(build_key);
		return { success: true };
	},

	async casc_close() {
		log.write('casc_close');
		const casc = core.get_casc();
		if (casc) {
			casc.cleanup?.();
			core.set_casc(null);
		}
	},

	async casc_get_file({ file_data_id }) {
		const casc = core.get_casc();
		if (!casc)
			throw new Error('no CASC source loaded');

		const data = await casc.getFile(file_data_id);
		if (!data)
			return null;

		data.processAllBlocks?.();
		return data.toBase64();
	},

	async casc_get_file_by_name({ name }) {
		const casc = core.get_casc();
		if (!casc)
			throw new Error('no CASC source loaded');

		const data = await casc.getFileByName(name);
		if (!data)
			return null;

		data.processAllBlocks?.();
		return data.toBase64();
	},

	async casc_get_file_partial({ file_data_id, offset, length }) {
		const casc = core.get_casc();
		if (!casc)
			throw new Error('no CASC source loaded');

		const data = await casc.getFile(file_data_id, false, false, true, offset, length);
		if (!data)
			return null;

		return data.toBase64();
	},
};

export const listfile_handlers = {
	async listfile_get_by_id({ id }) {
		return listfile.getByID(id) ?? null;
	},

	async listfile_get_by_name({ name }) {
		return listfile.getByFilename(name) ?? null;
	},

	async listfile_get_filtered({ filter, ext, prefilter }) {
		if (prefilter)
			return listfile.getFilenamesByExtension(ext ? [ext] : []);

		const search = filter instanceof RegExp ? filter : filter?.toLowerCase?.() ?? '';
		return listfile.getFilteredEntries(search);
	},

	async listfile_get_prefilter({ type }) {
		switch (type) {
			case 'textures':
				return listfile.get_textures();
			case 'sounds':
				return listfile.get_sounds();
			case 'text':
				return listfile.get_text();
			case 'fonts':
				return listfile.get_fonts();
			case 'models':
				return listfile.get_models();
			default:
				return [];
		}
	},

	async listfile_get_tree({ path }) {
		// tree navigation is handled via binary tree nodes in binary mode
		// for now, return empty - full tree support is view-side
		return [];
	},

	async listfile_strip_prefix({ name }) {
		return listfile.stripFileEntry(name);
	},
};
