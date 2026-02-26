import * as core from '../lib/core.js';
import * as log from '../lib/log.js';
import { MPQInstall } from '../mpq/mpq-install.js';

export const mpq_handlers = {
	async mpq_init({ path }) {
		log.write('mpq_init: %s', path);
		const mpq = new MPQInstall(path);
		await mpq.loadInstall();
		core.set_mpq(mpq);
		return { build_id: mpq.build_id };
	},

	async mpq_close() {
		log.write('mpq_close');
		const mpq = core.get_mpq();
		if (mpq) {
			mpq.close();
			core.set_mpq(null);
		}
	},

	async mpq_get_file({ path }) {
		const mpq = core.get_mpq();
		if (!mpq)
			throw new Error('no MPQ source loaded');

		const data = mpq.getFile(path);
		if (data === null)
			return null;

		return Buffer.from(data).toString('base64');
	},

	async mpq_get_files_by_extension({ extension }) {
		const mpq = core.get_mpq();
		if (!mpq)
			throw new Error('no MPQ source loaded');

		return mpq.getFilesByExtension(extension);
	},

	async mpq_get_all_files() {
		const mpq = core.get_mpq();
		if (!mpq)
			throw new Error('no MPQ source loaded');

		return mpq.getAllFiles();
	},

	async mpq_get_build_id() {
		const mpq = core.get_mpq();
		return mpq?.build_id ?? null;
	},
};
