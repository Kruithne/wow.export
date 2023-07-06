/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { serve, caution, ServerStop } from 'spooder';

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
	const chunks = [];

	if (!git.stdout) {
		caution('failed to spawn git process', {
			cmd: 'git rev-parse HEAD',
			endpoint: '/services/internal/head'
		});

		return 500;
	}

	// TODO: Replace this with TextDecoderStream once it's available in bun.
	// See https://github.com/oven-sh/bun/issues/159
	for await (const chunk of git.stdout)
		chunks.push(chunk);

	const output = new TextDecoder().decode(Uint8Array.from(chunks));

	// Expecting 40 hex characters followed by a newline.
	if (!/^[a-f0-9]{40}\n$/.test(output)) {
		caution('git rev-parse HEAD returned unexpected output', {
			cmd: 'git rev-parse HEAD',
			endpoint: '/services/internal/head',
			chunk_count: chunks.length,
			output
		});

		return 500;
	}

	return output.trim();
});