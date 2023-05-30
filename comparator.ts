/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

import fs from 'node:fs';
import path from 'node:path';

type Manifest = Map<string, Uint8Array>;

function invariant(condition: boolean, message: string): asserts condition {
	if (!condition)
		throw new Error(message);
}

/**
 * Recursively walk a directory and returns an array of all files found.
 * Directories are not included in the returned array.
 * Ignores files based on `ignored_files` constant.
 * e.g walk_directory('/a/b') => ['/a/b/file1.txt', '/a/b/c/file2.txt']
 */
function walk_directory(dir_path: string, out_entries: string[] = []): string[] {
	const dir_entries = fs.readdirSync(dir_path, { withFileTypes: true });
	for (const dir_entry of dir_entries) {
		const dir_entry_path = path.join(dir_path, dir_entry.name);

		if (dir_entry.isDirectory()) {
			walk_directory(dir_entry_path, out_entries);
		} else if (dir_entry.isFile()) {
			out_entries.push(dir_entry_path);
		}
	}

	return out_entries;
}

/** Returns the stats of a file, or null if the file cannot be stat'd. */
function stat_file(file_path: string): fs.Stats | null {
	try {
		return fs.statSync(file_path);
	} catch (e) {
		return null;
	}
}

/** Parses a manifest file and returns an array of entries. */
function parse_manifest(manifest_data: ArrayBuffer): Map<string, Uint8Array> {
	const manifest = new Map<string, Uint8Array>();
	const buf = Buffer.from(manifest_data);

	const entry_count = buf.readUInt32LE(0);
	let offset = 4;

	for (let i = 0; i < entry_count; i++) {
		// Read UInt32LE for the length of the path string.
		const path_length = buf.readUInt32LE(offset);
		offset += 4;

		// Read the path string.
		const path_string = buf.toString('utf8', offset, offset + path_length);
		offset += path_length;

		// Read the file hash as bytes.
		const hash_bytes = buf.subarray(offset, offset + 20);
		offset += 20;

		manifest.set(path_string, hash_bytes);
	}

	return manifest;
}

async function generate_manifest(eval_paths: string[]): Promise<Map<string, Uint8Array>> {
	const manifest = new Map<string, Uint8Array>();
	const files = new Array<string>();

	for (const eval_path of eval_paths) {
		const stat = stat_file(eval_path);

		if (stat !== null) {
			if (stat.isDirectory()) {
				// Directories need to be walked recursively.
				files.push(...walk_directory(eval_path));
			} else {
				// Root files can be added directly if they exist.
				files.push(eval_path);
			}
		}
	}

	for (const file_path of files) {
		const file = Bun.file(file_path);
		const file_hash = new Bun.CryptoHasher('sha1');
		file_hash.update(await file.arrayBuffer());
		manifest.set(file_path, file_hash.digest() as Uint8Array);
	}

	return manifest;
}

/** Compiles a manifest into a binary buffer. */
function compile_manifest(manifest: Manifest): ArrayBufferLike {
	let manifest_size = 4;
	for (const [path, hash] of manifest)
		manifest_size += 4 + path.length + hash.length;
	
	const buf = Buffer.alloc(manifest_size);

	let offset = 0;
	buf.writeUInt32LE(manifest.size, offset);
	offset += 4;

	for (const [path, hash] of manifest) {
		buf.writeUInt32LE(path.length, offset);
		offset += 4;

		buf.write(path, offset, path.length, 'utf8');
		offset += path.length;

		Buffer.from(hash).copy(buf, offset);
		offset += hash.length;
	}

	return buf.buffer;
}

async function import_triggers(trigger_path: string) {
	try {
		return (await import(trigger_path)).default.include;
	} catch (e) {
		return [];
	}
}

function compare_typed_arrays(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length)
		return false;

	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i])
			return false;
	}

	return true;
}

(async function main() {
	const argv = process.argv.slice(2);
	invariant(argv.length === 2, 'Expected two arguments: <manifest_path> <trigger_path>');

	const manifest_path = argv[0];
	const trigger_path = argv[1];

	const manifest_file = Bun.file(manifest_path);
	const manifest = manifest_file.size > 0 ? parse_manifest(await manifest_file.arrayBuffer()) : new Map() as Manifest;

	const triggers = await import_triggers(trigger_path);
	const generated_manifest = await generate_manifest(triggers);

	const changes = new Set();
	for (const [path, hash] of manifest) {
		if (!generated_manifest.has(path) || !compare_typed_arrays(generated_manifest.get(path)!, hash))
			changes.add(path);
	}

	for (const [path, hash] of generated_manifest) {
		if (!manifest.has(path) || !compare_typed_arrays(manifest.get(path)!, hash))
			changes.add(path);
	}

	if (changes.size > 0) {
		for (const path of changes)
			console.log(path);
	} else {
		console.log('No changes detected.');
	}

	fs.mkdirSync(path.dirname(manifest_path), { recursive: true });
	await Bun.write(manifest_path, compile_manifest(generated_manifest));
})();