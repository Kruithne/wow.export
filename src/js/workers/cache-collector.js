const { workerData, parentPort } = require('worker_threads');
const https = require('https');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

const WDB_MIN_SIZE = 32;
const CHUNK_SIZE = 5 * 1024 * 1024;

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

function log(msg) {
	parentPort.postMessage(msg);
}

function https_request(url, options, body) {
	return new Promise((resolve, reject) => {
		const parsed = new (require('url').URL)(url);
		const req = https.request({
			hostname: parsed.hostname,
			port: parsed.port || 443,
			path: parsed.pathname + parsed.search,
			method: options.method || 'GET',
			headers: options.headers || {}
		}, res => {
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => {
				const data = Buffer.concat(chunks).toString('utf8');
				resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data });
			});
		});

		req.on('error', reject);

		if (body)
			req.write(body);

		req.end();
	});
}

async function json_post(url, payload, user_agent) {
	const body = JSON.stringify(payload);
	const res = await https_request(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': user_agent,
			'Content-Length': Buffer.byteLength(body)
		}
	}, body);

	let json = null;
	if (res.ok) {
		try {
			json = JSON.parse(res.data);
		} catch {}
	}

	return { status: res.status, ok: res.ok, json };
}

function build_multipart(boundary, file_buf, offset) {
	const parts = [];

	// file field
	parts.push(Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="file"; filename="chunk.bin"\r\n` +
		`Content-Type: application/octet-stream\r\n\r\n`
	));
	parts.push(file_buf);
	parts.push(Buffer.from('\r\n'));

	// offset field
	const offset_str = offset.toString();
	parts.push(Buffer.from(
		`--${boundary}\r\n` +
		`Content-Disposition: form-data; name="offset"\r\n\r\n` +
		`${offset_str}\r\n`
	));

	// closing boundary
	parts.push(Buffer.from(`--${boundary}--\r\n`));

	return Buffer.concat(parts);
}

async function upload_chunks(url, buffer) {
	const boundary = crypto.randomBytes(16).toString('hex');

	for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
		const chunk = buffer.slice(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
		const body = build_multipart(boundary, chunk, offset);

		const res = await https_request(url, {
			method: 'POST',
			headers: {
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
				'Content-Length': body.length
			}
		}, body);

		if (!res.ok)
			throw new Error('upload chunk failed: ' + res.status);
	}
}

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
		const hash = crypto.createHash('md5');
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
					wdb_files.push({ name: file, locale: locale_entry.name, size: stat.size, path: file_path });
			} catch {}
		}
	}

	return wdb_files;
}

async function scan_adb(flavor_dir) {
	const adb_root = path.join(flavor_dir, 'Cache', 'ADB');
	const adb_files = [];

	let locale_dirs;
	try {
		locale_dirs = await fsp.readdir(adb_root, { withFileTypes: true });
	} catch {
		return adb_files;
	}

	for (const locale_entry of locale_dirs) {
		if (!locale_entry.isDirectory())
			continue;

		const file_path = path.join(adb_root, locale_entry.name, 'DBCache.bin');
		try {
			const stat = await fsp.stat(file_path);
			if (stat.size > WDB_MIN_SIZE)
				adb_files.push({ name: 'DBCache.bin', locale: locale_entry.name, size: stat.size, path: file_path });
		} catch {}
	}

	return adb_files;
}

async function load_state(state_path) {
	try {
		const data = await fsp.readFile(state_path, 'utf8');
		return JSON.parse(data);
	} catch {
		return {};
	}
}

async function save_state(state_path, state) {
	await fsp.writeFile(state_path, JSON.stringify(state), 'utf8');
}

async function upload_flavor(result, state) {
	const { machine_id, submit_url, finalize_url, user_agent } = workerData;

	if (!result.cache_files || result.cache_files.length === 0)
		return;

	const flavor_key = `${result.product}|${result.patch}|${result.build_number}`;
	const prev_hashes = state[flavor_key] || {};

	const file_buffers = new Map();
	const file_hashes = new Map();
	const submit_files = [];

	for (const wdb of result.cache_files) {
		try {
			const buffer = await fsp.readFile(wdb.path);
			const key = `${wdb.locale}/${wdb.name}`;
			const hash = crypto.createHash('sha256').update(buffer).digest('hex');

			file_hashes.set(key, hash);

			if (prev_hashes[key] === hash)
				continue;

			file_buffers.set(key, buffer);
			submit_files.push({ name: wdb.name, locale: wdb.locale, size: buffer.length });
		} catch (e) {
			log(`failed to read ${wdb.path}: ${e.message}`);
		}
	}

	if (submit_files.length === 0) {
		log(`all files unchanged for ${result.product}, skipping`);
		return;
	}

	const submit_res = await json_post(submit_url, {
		machine_id,
		product: result.product,
		patch: result.patch,
		build_number: parseInt(result.build_number) || 0,
		build_key: result.build_key,
		cdn_key: result.cdn_key,
		binary_hash: result.binary_hash || '',
		binary_name: result.binary_name || '',
		files: submit_files
	}, user_agent);

	if (!submit_res.ok) {
		log(`submit failed (${submit_res.status}) for ${result.product}`);
		return;
	}

	const { submission_id, upload_urls } = submit_res.json;
	log(`submission ${submission_id} created for ${result.product} (${submit_files.length} files)`);

	const checksums = {};

	for (const [key, buffer] of file_buffers) {
		const url = upload_urls[key];
		if (!url) {
			log(`no upload URL for ${key}`);
			continue;
		}

		try {
			await upload_chunks(url, buffer);
			checksums[key] = file_hashes.get(key);
		} catch (e) {
			log(`upload failed for ${key}: ${e.message}`);
		}
	}

	const finalize_res = await json_post(finalize_url, { submission_id, checksums }, user_agent);

	if (finalize_res.ok) {
		log(`submission ${submission_id} finalized`);

		// update state with hashes of successfully uploaded files
		const new_hashes = { ...prev_hashes };
		for (const key of Object.keys(checksums))
			new_hashes[key] = checksums[key];

		state[flavor_key] = new_hashes;
	} else {
		log(`finalize failed (${finalize_res.status}) for ${submission_id}`);
	}
}

async function collect() {
	const { install_path, state_path } = workerData;
	const state = await load_state(state_path);

	const build_info_path = path.join(install_path, '.build.info');
	const build_info_text = await fsp.readFile(build_info_path, 'utf8');
	const builds = parse_build_info(build_info_text);

	if (builds.length === 0)
		return;

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

	for (const flavor of flavor_dirs) {
		const build_row = builds.find(b => b.Product === flavor.product);
		if (!build_row)
			continue;

		const flavor_path = path.join(install_path, flavor.dir);

		const binary_path = await find_binary(flavor_path, flavor.product);
		let binary_hash = null;
		if (binary_path) {
			try {
				binary_hash = await hash_file(binary_path);
			} catch {}
		}

		const wdb_files = await scan_wdb(flavor_path);
		const adb_files = await scan_adb(flavor_path);
		const cache_files = [...wdb_files, ...adb_files];

		if (cache_files.length === 0)
			continue;

		const version = build_row.Version || '';
		const version_parts = version.match(/^(.+)\.(\d+)$/);
		const patch = version_parts ? version_parts[1] : version;
		const build_number = version_parts ? version_parts[2] : '';

		try {
			await upload_flavor({
				product: flavor.product,
				patch,
				build_number,
				build_key: build_row['Build Key'] || '',
				cdn_key: build_row['CDN Key'] || '',
				binary_hash,
				binary_name: binary_path ? path.basename(binary_path) : '',
				cache_files
			}, state);
		} catch (e) {
			log(`error for ${flavor.product}: ${e.message}`);
		}
	}

	await save_state(state_path, state);
}

collect().catch(err => log(`fatal: ${err.message}`));
