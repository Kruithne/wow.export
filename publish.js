/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import path from 'node:path';
import util from 'node:util';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import manifest from './package.json';
import AdmZip from 'adm-zip';

const BUILD_DIR = path.join(__dirname, 'bin');
const PUBLISH_DIR = path.join(__dirname, 'publish');

const deflate_buffer = util.promisify(zlib.deflate);

const argv = process.argv.splice(2);
const PUBLISH_BUILDS = argv.length > 0 ? argv : ['win-x64', 'linux-x64', 'osx-x64'];

const INSTALLER_NAMES = {
	'win-x64': 'installer.exe',
	'linux-x64': 'installer',
	'osx-x64': 'installer'
};

async function collect_files(dir, out = []) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entry_path = path.join(dir, entry.name);
		if (entry.isDirectory())
			await collect_files(entry_path, out);
		else
			out.push(entry_path);
	}
	return out;
}

async function create_data_pak(build_dir, output_dir) {
	const pak_path = path.join(output_dir, 'data.pak');
	const manifest_path = path.join(output_dir, 'data.pak.json');

	console.log('  Creating data.pak...');

	const files = await collect_files(build_dir);
	const contents = {};
	let comp_size = 0;

	await fs.writeFile(pak_path, Buffer.alloc(0));

	for (const file of files) {
		const relative = path.relative(build_dir, file).replace(/\\/g, '/');
		const data = await fs.readFile(file);
		const compressed = await deflate_buffer(data);

		await fs.appendFile(pak_path, compressed);

		contents[relative] = {
			size: data.byteLength,
			compSize: compressed.byteLength,
			ofs: comp_size
		};

		comp_size += compressed.byteLength;
	}

	const manifest_data = { contents };
	await fs.writeFile(manifest_path, JSON.stringify(manifest_data, null, '\t'), 'utf8');

	console.log('  data.pak created (%d files, %d bytes compressed)', files.length, comp_size);
	return { pak_path, manifest_path };
}

async function create_archive(source_dir, archive_path, is_windows) {
	if (is_windows) {
		const zip = new AdmZip();
		zip.addLocalFolder(source_dir);
		zip.writeZip(archive_path);
	} else {
		const proc = Bun.spawn({
			cmd: [
				'tar',
				'-czf',
				archive_path,
				'-C',
				source_dir,
				'.'
			]
		});

		await proc.exited;
		if (proc.exitCode !== 0)
			throw new Error(`tar process exited with code ${proc.exitCode}: ${proc.stderr?.toString() || 'Unknown error'}`);
	}
}

for (const build_tag of PUBLISH_BUILDS) {
	try {
		console.log(`publishing build ${build_tag} with version ${manifest.version}...`);

		const is_windows = build_tag === 'win-x64';
		const archive_ext = is_windows ? '.zip' : '.tar.gz';

		const build_dir_path = path.join(BUILD_DIR, build_tag);
		const installer_dir_path = path.join(BUILD_DIR, build_tag + '-installer');
		const update_file_path = path.join(build_dir_path, 'update');
		const update_manifest_path = update_file_path + '.json';

		const pub_dir = path.join(PUBLISH_DIR, build_tag);
		await fs.mkdir(pub_dir, { recursive: true });

		// move update files (unchanged from original)
		await fs.rename(update_file_path, path.join(pub_dir, 'update'));
		await fs.rename(update_manifest_path, path.join(pub_dir, 'update.json'));

		// create portable archive (raw program files)
		const portable_archive_name = util.format('portable-wow-export-%s-%s%s', build_tag, manifest.version, archive_ext);
		const portable_archive_path = path.join(pub_dir, portable_archive_name);

		console.log('  Creating portable archive...');
		await create_archive(build_dir_path, portable_archive_path, is_windows);
		console.log('  Created: %s', portable_archive_name);

		// create staging directory for installer package
		const staging_dir = path.join(pub_dir, 'staging');
		await fs.rm(staging_dir, { recursive: true, force: true });
		await fs.mkdir(staging_dir, { recursive: true });

		// create data.pak from build files
		await create_data_pak(build_dir_path, staging_dir);

		// copy installer to staging
		const installer_name = INSTALLER_NAMES[build_tag];
		const installer_src = path.join(installer_dir_path, installer_name);
		const installer_dst = path.join(staging_dir, installer_name);
		await fs.copyFile(installer_src, installer_dst);
		console.log('  Copied installer: %s', installer_name);

		// create installer archive
		const installer_archive_name = util.format('wow-export-%s-%s%s', build_tag, manifest.version, archive_ext);
		const installer_archive_path = path.join(pub_dir, installer_archive_name);

		console.log('  Creating installer archive...');
		await create_archive(staging_dir, installer_archive_path, is_windows);
		console.log('  Created: %s', installer_archive_name);

		// cleanup staging directory
		await fs.rm(staging_dir, { recursive: true, force: true });

		console.log(`successfully published build ${build_tag}`);
	} catch (e) {
		console.error(`failed to publish build ${build_tag}: ${e.message}`);
	}
}
