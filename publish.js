/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import path from 'node:path';
import util from 'node:util';
import fs from 'node:fs/promises';
import manifest from './package.json';
import AdmZip from 'adm-zip';

const BUILD_DIR = path.join(__dirname, 'bin');
const PUBLISH_DIR = path.join(__dirname, 'publish');

const argv = process.argv.splice(2);
const PUBLISH_BUILDS = argv.length > 0 ? argv : ['win-x64', 'linux-x64', 'osx-x64'];
const ZIP_FORMAT = 'wow-export-%s-%s.zip';

for (const build_tag of PUBLISH_BUILDS) {
	try {
		console.log(`publishing build ${build_tag} with version ${manifest.version}...`);

		const build_dir_path = path.join(BUILD_DIR, build_tag);
		const update_file_path = path.join(build_dir_path, 'update');
		const update_manifest_path = update_file_path + '.json';

		const pub_dir = path.join(PUBLISH_DIR, build_tag);
		await fs.mkdir(pub_dir, { recursive: true });

		await fs.rename(update_file_path, path.join(pub_dir, 'update'));
		await fs.rename(update_manifest_path, path.join(pub_dir, 'update.json'));
		
		const zip = new AdmZip();
		zip.addLocalFolder(build_dir_path);
		zip.writeZip(path.join(pub_dir, util.format(ZIP_FORMAT, build_tag, manifest.version)));
		
		console.log(`successfully published build ${build_tag}`);
	} catch (e) {
		console.error(`failed to publish build ${build_tag}: ${e.message}`);
	}
}