/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { serve, ServerStop } from 'spooder';

const server = serve(3001);

server.route('/services/internal/update', (req: Request, url: URL) => {
	if (url.searchParams.get('key') !== process.env.WOW_EXPORT_SERVER_DEPLOY_KEY)
		return 401;

	server.stop(ServerStop.GRACEFUL);
	return 200;
});

server.route('/services/internal/head', (req: Request, url: URL) => {
	if (url.searchParams.get('key') !== process.env.WOW_EXPORT_SERVER_DEPLOY_KEY)
		return 401;

	// TODO: Fortify this against potentially returning an error.
	const git = Bun.spawn(['git', 'rev-parse', 'HEAD']);
	return git.stdout;
});