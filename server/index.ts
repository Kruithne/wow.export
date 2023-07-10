/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import { serve, ServerStop } from 'spooder';
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

const server = serve(3001);

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

server.route('/services/internal/release/:build', async (req: Request, url: URL) => {
	if (!verify_build_key(url))
		return 401; // unauthorized

	const git_head = await get_git_head();
	const build_id = url.searchParams.get('build');
	if (build_id === null)
		return 400; // bad request

	const build_zip = `build-${build_id}.zip`;

	// reset temporary release directory
	await fs.rm(TMP_RELEASE_DIR, { recursive: true, force: true });
	await fs.mkdir(TMP_RELEASE_DIR);

	// stream zip from request to temporary release directory
	const zip_file_path = path.join(TMP_RELEASE_DIR, build_zip);
	await Bun.write(zip_file_path, new Response(req.body));

	// extract zip contents to /var/wowexport/release/<git_head>
	await spawn_safe(`unzip -o ${zip_file_path} -d /var/wowexport/release/${git_head}`);

	// move zip to /var/wowexport/release/release.tar.gz
	await fs.rename(zip_file_path, path.join('/var/wowexport/release', build_zip));

	// remove temporary release directory
	await fs.rm(TMP_RELEASE_DIR, { recursive: true, force: true });
});

server.dir('/', './front', { index: 'index.html' });