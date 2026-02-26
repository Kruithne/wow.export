/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import * as fs from 'node:fs';
import * as log from '../lib/log.js';

const DEFAULT_BUILD = '1.12.1.5875';

// known mpq files -> expansion build defaults
const EXPANSION_BUILDS = {
	wotlk: '3.3.5.12340',
	tbc: '2.4.3.8606',
	vanilla: '1.12.1.5875'
};

const VS_FIXEDFILEINFO_SIGNATURE = 0xFEEF04BD;

const parse_vs_fixed_file_info = (buf, offset) => {
	if (offset + 52 > buf.length)
		return null;

	const signature = buf.readUInt32LE(offset);
	if (signature !== VS_FIXEDFILEINFO_SIGNATURE)
		return null;

	const file_version_ms = buf.readUInt32LE(offset + 8);
	const file_version_ls = buf.readUInt32LE(offset + 12);

	const major = (file_version_ms >>> 16) & 0xFFFF;
	const minor = file_version_ms & 0xFFFF;
	const build = (file_version_ls >>> 16) & 0xFFFF;
	const revision = file_version_ls & 0xFFFF;

	return `${major}.${minor}.${build}.${revision}`;
};

const find_version_in_buffer = (buf) => {
	// search for signature 0xFEEF04BD (little-endian: BD 04 EF FE)
	const sig_bytes = Buffer.from([0xBD, 0x04, 0xEF, 0xFE]);

	let pos = 0;
	while (pos < buf.length - 52) {
		const idx = buf.indexOf(sig_bytes, pos);
		if (idx === -1)
			break;

		const version = parse_vs_fixed_file_info(buf, idx);
		if (version !== null)
			return version;

		pos = idx + 1;
	}

	return null;
};

const read_exe_version = (exe_path) => {
	try {
		const buf = fs.readFileSync(exe_path);

		if (buf.length < 64)
			return null;

		// check DOS header magic (MZ)
		if (buf.readUInt16LE(0) !== 0x5A4D)
			return null;

		const version = find_version_in_buffer(buf);
		if (version !== null)
			log.write('detected build version from %s: %s', exe_path.split(/[\\/]/).pop(), version);

		return version;
	} catch (e) {
		return null;
	}
};

const find_wow_exe = (directory) => {
	const candidates = ['WoW.exe', 'WowClassic.exe', 'Wow.exe', 'wow.exe'];
	const search_dirs = [directory, directory.replace(/[\\/][^\\/]*$/, '')];

	for (const dir of search_dirs) {
		for (const exe_name of candidates) {
			const exe_path = dir + '/' + exe_name;
			if (fs.existsSync(exe_path))
				return exe_path;
		}
	}

	return null;
};

const infer_expansion_from_mpqs = (mpq_names) => {
	const names_set = new Set(mpq_names.map(n => n.split(/[\\/]/).pop().toLowerCase()));

	if (names_set.has('lichking.mpq') || names_set.has('expansion2.mpq'))
		return 'wotlk';

	if (names_set.has('expansion.mpq'))
		return 'tbc';

	return 'vanilla';
};

const detect_build_version = (directory, mpq_files) => {
	const exe_path = find_wow_exe(directory);
	if (exe_path !== null) {
		const exe_version = read_exe_version(exe_path);
		if (exe_version !== null)
			return exe_version;
	}

	const expansion = infer_expansion_from_mpqs(mpq_files);
	const build = EXPANSION_BUILDS[expansion];
	log.write('inferred %s expansion from MPQ files, using build %s', expansion, build);
	return build;
};

export {
	detect_build_version,
	DEFAULT_BUILD
};
