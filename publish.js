/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import path from 'node:path';
import util from 'node:util';
import manifest from './package.json';
import AdmZip from 'adm-zip';

const ENDPOINT_BASE = 'wss://kruithne.net/wow.export/v2';

const BUILD_DIR = path.join(__dirname, 'bin');
const PUBLISH_DIR = path.join(__dirname, 'publish');

const PUBLISH_BUILDS = ['win-x64'];
const ZIP_FORMAT = 'wow-export-%s-%s.zip';

for (const build_tag of PUBLISH_BUILDS) {
	try {
		console.log(`publishing build ${build_tag} with version ${manifest.version}...`);

		const build_dir_path = path.join(BUILD_DIR, build_tag);
		const build_dir = Bun.file(build_dir_path);
		await build_dir.stat(); // existence check

		const update_file_path = path.join(build_dir_path, 'update');
		const update_file = Bun.file(update_file_path);
		await update_file.stat(); // existence check

		const update_manifest = Bun.file(update_file_path + '.json');
		await update_manifest.stat(); // existence check

		const m_size = update_manifest.size;
		const c_size = update_file.size;
		const t_size = m_size + c_size;

		const data = new ArrayBuffer(t_size);

		const update_file_data = await update_file.arrayBuffer();
		const update_manifest_data = await update_manifest.arrayBuffer();

		const view = new Uint8Array(data);
		view.set(new Uint8Array(update_file_data), 0);
		view.set(new Uint8Array(update_manifest_data), update_file.size);

		const pub_dir = path.join(PUBLISH_DIR, build_tag);
		await Bun.write(path.join(pub_dir, 'update'), data);
		
		await update_file.delete();
		await update_manifest.delete();
		
		const zip = new AdmZip();
		zip.addLocalFolder(build_dir_path);
		zip.writeZip(path.join(pub_dir, util.format(ZIP_FORMAT, build_tag, manifest.version)));
		
		console.log(`successfully published build ${build_tag}`);
	} catch (e) {
		console.error(`failed to publish build ${build_tag}: ${e.message}`);
	}
}