// This script is run automatically by .github/workflows/update_patch.yml

const UPLOAD_CHUNK_SIZE = 1024 * 1024 * 5; // 5MB

import fs from 'node:fs';
import path from 'node:path';

async function read_chunk(fd: number, offset: number, length: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const buffer = Buffer.alloc(length);
		fs.read(fd, buffer, 0, length, offset, (err) => {
			if (err)
				return reject(err);

			resolve(new Blob([buffer]));
		});
	});
}

try {
	const deploy_key = process.argv[2];
	if (deploy_key === undefined || deploy_key.length === 0)
		throw new Error('missing deploy key, usage: node action_update_server.js <deploy_key>');

	const archive_file_name = './bin/packages/wow.export.zip';
	const archive_file_stat = await fs.promises.stat(archive_file_name);
	const archive_file_descriptor = await fs.promises.open(archive_file_name, 'r');

	const num_upload_chunks = Math.ceil(archive_file_stat.size / UPLOAD_CHUNK_SIZE);
	console.log(`uploading archive in ${num_upload_chunks} chunks...`);

	for (let i = 0; i < num_upload_chunks; i++) {
		const form_data = new FormData();

		const chunk_size = Math.min(UPLOAD_CHUNK_SIZE, archive_file_stat.size - (i * UPLOAD_CHUNK_SIZE));
		const chunk_data = await read_chunk(archive_file_descriptor, i * UPLOAD_CHUNK_SIZE, chunk_size);

		console.log(`expected chunk size: ${chunk_size}`);
		console.log(`chunk ${i + 1}/${num_upload_chunks} (${Math.round(chunk_data.size / 1024 / 1024)}MB)`);

		form_data.append('chunk', chunk_data, path.basename(archive_file_name));
		form_data.append('offset', (i * UPLOAD_CHUNK_SIZE).toString());

		if (i === 0)
			form_data.append('size', archive_file_stat.size.toString());
		else if (i === num_upload_chunks - 1)
			form_data.append('final', '1');

		const url = 'https://wowexport.net/services/internal/upload_release_chunk/win-x64?key=' + deploy_key;
		const res = await fetch(url, {
			method: 'POST',
			body: form_data
		});

		if (!res.ok)
			throw new Error(`failed to upload chunk ${i + 1}/${num_upload_chunks} (${res.status} ${res.statusText})`);
	}
} catch (e) {
	console.error(e);
	process.exit(1);
}

export {}; // Enables top-level await by making this file a module.