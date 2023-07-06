/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { serve, caution, ServerStop } from 'spooder';
import { merge_typed_array, stream_to_array } from './util';

const server = serve(3001);

server.route('/services/internal/update', (req: Request, url: URL) => {
	if (url.searchParams.get('key') !== process.env.WOW_EXPORT_SERVER_DEPLOY_KEY)
		return 401;

	server.stop(ServerStop.GRACEFUL);
	return 200;
});

server.route('/services/internal/head', async (req: Request, url: URL) => {
	if (url.searchParams.get('key') !== process.env.WOW_EXPORT_SERVER_DEPLOY_KEY)
		return 401;

	const git = Bun.spawn(['git', 'rev-parse', 'HEAD']);

	if (!git.stdout) {
		caution('failed to spawn git process', {
			cmd: 'git rev-parse HEAD',
			endpoint: '/services/internal/head'
		});

		return 500;
	}

	const merged = merge_typed_array(await stream_to_array(git.stdout));
	const decoded = new TextDecoder().decode(merged);

	// Expecting 40 hex characters followed by a newline.
	if (!/^[a-f0-9]{40}\n$/.test(decoded)) {
		caution('git rev-parse HEAD returned unexpected output', {
			cmd: 'git rev-parse HEAD',
			endpoint: '/services/internal/head',
			merged,
			decoded
		});

		return 500;
	}

	return decoded.trim();
});