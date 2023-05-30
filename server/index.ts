/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import http from 'http';

function make_generic_response(status_code: number): Response {
	return new Response(http.STATUS_CODES[status_code], { status: status_code });
}

const server = Bun.serve({
	port: 3001, // Do not change without consulting @Kruithne
	development: false,

	fetch(req) {
		const url = new URL(req.url);

		// /services/hooks/server is called from the automatic deployment workflow on GitHub
		// to indicate that the server sources have been updated and the server should initiate
		// a self-update.
		if (url.pathname === '/services/hooks/server') {
			// This endpoint must be called with the correct key to prevent abuse.
			if (url.searchParams.get('key') !== process.env.WOW_EXPORT_SERVER_DEPLOY_KEY)
				return make_generic_response(401); // Unauthorized

			return make_generic_response(200); // OK
		}

		return make_generic_response(404); // Not found
	},

	error(error: Error) {
		console.error(error);
		return make_generic_response(500); // Internal Server Error
	}
});

console.log(`Ready for connections ${server.port}...`);