const { workerData, parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

const WDB_MIN_SIZE = 32;

const BINARY_NAMES = {
	'wow': 'Wow.exe',
	'wowt': 'WowT.exe',
	'wow_beta': 'WowB.exe',
	'wow_classic': 'WowClassic.exe',
	'wow_classic_era': 'WowClassic.exe',
	'wow_classic_era_ptr': 'WowClassic.exe',
	'wow_classic_ptr': 'WowClassic.exe',
	'wow_classic_beta': 'WowClassic.exe'
};

function parse_build_info(text) {
	const lines = text.split('\n').filter(line => line.length > 0);
	if (lines.length < 2)
		return [];

	const headers = lines[0].split('|').map(h => h.split('!')[0]);
	const rows = [];

	for (let i = 1; i < lines.length; i++) {
		const values = lines[i].split('|');
		const row = {};
		for (let j = 0; j < headers.length; j++)
			row[headers[j]] = values[j]?.trim() ?? '';

		rows.push(row);
	}

	return rows;
}

async function hash_file(file_path) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(file_path);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});
}

async function find_binary(flavor_dir, product) {
	const known_name = BINARY_NAMES[product];
	if (known_name) {
		const bin_path = path.join(flavor_dir, known_name);
		try {
			await fsp.access(bin_path);
			return bin_path;
		} catch {}
	}

	// fallback: scan for Wow*.exe
	try {
		const entries = await fsp.readdir(flavor_dir);
		const candidates = entries.filter(e => /^Wow.*\.exe$/i.test(e));
		if (candidates.length > 0)
			return path.join(flavor_dir, candidates[0]);
	} catch {}

	return null;
}

async function scan_wdb(flavor_dir) {
	const wdb_root = path.join(flavor_dir, 'Cache', 'WDB');
	const wdb_files = [];

	let locale_dirs;
	try {
		locale_dirs = await fsp.readdir(wdb_root, { withFileTypes: true });
	} catch {
		return wdb_files;
	}

	for (const locale_entry of locale_dirs) {
		if (!locale_entry.isDirectory())
			continue;

		const locale_path = path.join(wdb_root, locale_entry.name);
		let files;
		try {
			files = await fsp.readdir(locale_path);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith('.wdb'))
				continue;

			const file_path = path.join(locale_path, file);
			try {
				const stat = await fsp.stat(file_path);
				if (stat.size > WDB_MIN_SIZE)
					wdb_files.push({ name: file, locale: locale_entry.name, size: stat.size });
			} catch {}
		}
	}

	return wdb_files;
}

async function collect() {
	const { install_path } = workerData;

	// parse .build.info
	const build_info_path = path.join(install_path, '.build.info');
	const build_info_text = await fsp.readFile(build_info_path, 'utf8');
	const builds = parse_build_info(build_info_text);

	if (builds.length === 0)
		return;

	// scan for _*_ flavor directories containing .flavor.info
	const root_entries = await fsp.readdir(install_path, { withFileTypes: true });
	const flavor_dirs = [];

	for (const entry of root_entries) {
		if (!entry.isDirectory() || !entry.name.startsWith('_') || !entry.name.endsWith('_'))
			continue;

		const flavor_info_path = path.join(install_path, entry.name, '.flavor.info');
		try {
			const flavor_text = await fsp.readFile(flavor_info_path, 'utf8');
			const product = flavor_text.trim().split('\n').pop()?.trim();
			if (product)
				flavor_dirs.push({ dir: entry.name, product });
		} catch {
			continue;
		}
	}

	const results = [];

	for (const flavor of flavor_dirs) {
		// match flavor to .build.info row
		const build_row = builds.find(b => b.Product === flavor.product);
		if (!build_row)
			continue;

		const flavor_path = path.join(install_path, flavor.dir);

		// find and hash binary
		const binary_path = await find_binary(flavor_path, flavor.product);
		let binary_hash = null;
		if (binary_path) {
			try {
				binary_hash = await hash_file(binary_path);
			} catch {}
		}

		// scan WDB caches
		const wdb_files = await scan_wdb(flavor_path);
		if (wdb_files.length === 0)
			continue;

		// split version into patch + build number
		const version = build_row.Version || '';
		const version_parts = version.match(/^(.+)\.(\d+)$/);
		const patch = version_parts ? version_parts[1] : version;
		const build_number = version_parts ? version_parts[2] : '';

		results.push({
			product: flavor.product,
			patch,
			build_number,
			build_key: build_row['Build Key'] || '',
			cdn_key: build_row['CDN Key'] || '',
			binary_hash,
			wdb_files
		});
	}

	parentPort.postMessage(results);
}

collect().catch(err => {
	parentPort.postMessage({ error: err.message });
});
