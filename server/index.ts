/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { serve, ServerStop, caution } from 'spooder';
import { get_git_head } from './util';

const TMP_RELEASE_DIR = path.join(os.tmpdir(), 'wow_export_srv_release_tmp');

function verify_build_key(url: URL): boolean {
	return url.searchParams.get('key') === process.env.WOW_EXPORT_SERVER_DEPLOY_KEY;
}

async function spawn_safe(command: string): Promise<void> {
	const proc = Bun.spawn(command.split(' '));
	await proc.exited;

	if (proc.exitCode !== 0)
		throw new Error(`Command "${command}" exited with code ${proc.exitCode}`);
}

function write_file_offset(file_name: string, data: Buffer, offset: number): Promise<number> {
	return new Promise((resolve, reject) => {
		fs.open(file_name, 'w', (err, fd) => {
			if (err)
				return reject(err);

			fs.write(fd, data, 0, data.length, offset, (err, written) => {
				if (err)
					return reject(err);

				resolve(written);
			});
		});
	});
}

const server = serve(3001);

server.error((err: Error) => {
	caution(err);
	return new Response('The kākāpō has exploded (internal server error)', { status: 500 });
});

server.route('/services/internal/update', (req: Request, url: URL) => {
	if (!verify_build_key(url))
		return 401; // unauthorized

	server.stop(ServerStop.GRACEFUL);
	return 200; // ok
});

server.route('/services/internal/head', async (req: Request, url: URL) => {
	if (!verify_build_key(url))
		return 401; // unauthorized

	return get_git_head();
});

server.route('/services/internal/upload_release_chunk/:build', async (req: Request, url: URL) => {
	if (!verify_build_key(url))
		return 401; // unauthorized

	const git_head = await get_git_head();
	const build_id = url.searchParams.get('build');
	if (build_id === null)
		return 400; // bad request

	const build_zip = `build-${build_id}.zip`;
	const zip_file_path = path.join(TMP_RELEASE_DIR, build_zip);

	const form_data = await req.formData();
	const offset = parseInt(form_data.get('offset') as string);

	const chunk = form_data.get('chunk') as Blob;
	const chunk_data = Buffer.from(await chunk.arrayBuffer());

	let write_buffer = chunk_data;

	if (form_data.has('size')) {
		const build_size = parseInt(form_data.get('size') as string);

		await fs.promises.rm(TMP_RELEASE_DIR, { recursive: true, force: true });
		await fs.promises.mkdir(TMP_RELEASE_DIR);

		write_buffer = Buffer.alloc(build_size);
		chunk_data.copy(write_buffer);
	}

	await write_file_offset(zip_file_path, chunk_data, offset);

	if (form_data.has('final')) {
		await spawn_safe(`unzip -o ${zip_file_path} -d /var/wowexport/release/${git_head}`);
		await fs.promises.rename(zip_file_path, path.join('/var/wowexport/release', build_zip));
		await fs.promises.rm(TMP_RELEASE_DIR, { recursive: true, force: true });
	}
});

server.dir('/', './front', { index: 'index.html' });