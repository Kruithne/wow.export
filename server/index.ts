/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { serve, ServerStop } from 'spooder';
import { get_git_head } from './util';

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

	return get_git_head();
});