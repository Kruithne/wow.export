// This script is run automatically by .github/workflows/update_patch.yml

const UPLOAD_CHUNK_SIZE = 1024 * 1024 * 50; // 50MB

try {
	const deploy_key = process.argv[2];
	if (deploy_key === undefined || deploy_key.length === 0)
		throw new Error('missing deploy key, usage: node action_update_server.js <deploy_key>');

	const archive_file = Bun.file('./bin/packages/wow.export.zip');
	const num_upload_chunks = Math.ceil(archive_file.size / UPLOAD_CHUNK_SIZE);

	console.log(`uploading archive in ${num_upload_chunks} chunks...`);

	for (let i = 0; i < num_upload_chunks; i++) {
		const formData = new FormData();
		formData.append('chunk', archive_file.slice(i * UPLOAD_CHUNK_SIZE, (i + 1) * UPLOAD_CHUNK_SIZE), 'wow.export.zip');
		formData.append('offset', (i * UPLOAD_CHUNK_SIZE).toString());

		if (i === 0)
			formData.append('size', archive_file.size.toString());
		else if (i === num_upload_chunks - 1)
			formData.append('final', '1');

		const url = 'https://wowexport.net/services/internal/upload_release_chunk/win-x64?key=' + deploy_key;
		const res = await fetch(url, {
			method: 'POST',
			body: formData
		});

		if (!res.ok)
			throw new Error(`failed to upload chunk ${i + 1}/${num_upload_chunks} (${res.status} ${res.statusText})`);
	}
} catch (e) {
	console.error(e);
	process.exit(1);
}

export {}; // Enables top-level await by making this file a module.